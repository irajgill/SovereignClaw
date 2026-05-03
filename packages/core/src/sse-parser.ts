/**
 * SSE parser for the 0G Compute Router streaming responses.
 *
 * The Router emits Server-Sent Events of the form:
 *
 *   data: {"choices":[{"delta":{"content":"<text>"},"index":0,...}],...}
 *   data: {"choices":[],"usage":{"prompt_tokens":21,"completion_tokens":9,"total_tokens":30}}
 *   data: {"x_0g_trace":{"request_id":"...","provider":"0x...","billing":{...},"tee_verified":true}}
 *   data: [DONE]
 *
 * Each event is a `data:` line followed by a blank line (CRLF or LF). Multi-line
 * `data:` is concatenated with newlines (per the SSE spec). Comment lines start
 * with `:` and are dropped.
 *
 * We layer the InferenceChunk semantics ON TOP of the raw SSE events:
 *   - delta-content frames -> 'token' chunks (non-empty text only)
 *   - usage-only frames    -> captured for the final 'done' chunk
 *   - x_0g_trace frames    -> captured as Attestation for the final 'done' chunk
 *   - [DONE]               -> emit 'done' with whatever usage/attestation we
 *                              accumulated, then close the iterator
 *
 * Tool calls are NOT yet emitted by the Router on the streams we observe; the
 * 'tool_call' chunk variant is reserved for forward-compat. If a future Router
 * version starts streaming `delta.tool_calls`, we add a branch here without
 * changing the InferenceChunk type.
 */
import type { Attestation, BillingInfo, TokenUsage } from './inference.js';
import { StreamInterruptedError } from './errors.js';

export type InferenceChunk =
  | { type: 'token'; text: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | {
      type: 'done';
      usage: TokenUsage | undefined;
      attestation: Attestation | null;
      billing: BillingInfo | undefined;
      /**
       * Total text accumulated from all 'token' chunks during this stream.
       * Surfaced so the inference adapter can populate InferenceResult.text
       * without making consumers re-concatenate.
       */
      text: string;
      /** Concatenated raw SSE events (one parsed JSON object per array entry). */
      raw: unknown[];
    };

interface RouterDeltaFrame {
  choices?: Array<{
    index?: number;
    finish_reason?: string | null;
    delta?: { role?: string; content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  x_0g_trace?: {
    request_id?: string;
    provider?: string;
    tee_verified?: boolean | null;
    billing?: {
      input_cost?: string;
      output_cost?: string;
      total_cost?: string;
    };
  };
}

function bigintFromWei(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

/**
 * Parse a single `data:` payload's JSON, classify it, and return a partial
 * accumulator update. Throws `StreamInterruptedError` on malformed JSON so the
 * outer iterator can surface the failure to the caller.
 */
function parseDataPayload(payload: string): RouterDeltaFrame {
  if (payload === '[DONE]') {
    return { __done: true } as unknown as RouterDeltaFrame;
  }
  try {
    return JSON.parse(payload) as RouterDeltaFrame;
  } catch (err) {
    throw new StreamInterruptedError(`malformed SSE JSON payload: ${payload.slice(0, 200)}`, {
      cause: err,
    });
  }
}

/**
 * Convert an SSE byte stream into a sequence of InferenceChunks. Handles
 * partial lines across TCP fragmentation and multi-line `data:` fields.
 *
 * The returned iterable terminates after a `'done'` chunk OR after the
 * underlying byte stream closes — whichever comes first.
 */
export async function* parseSSEStream(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<InferenceChunk> {
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8');

  // Accumulators kept across the whole stream.
  let buffer = '';
  let dataLines: string[] = [];
  let usage: TokenUsage | undefined;
  let billing: BillingInfo | undefined;
  let attestation: Attestation | null = null;
  let totalText = '';
  const raw: unknown[] = [];
  let doneEmitted = false;

  const flushEvent = function* (): Generator<InferenceChunk> {
    if (dataLines.length === 0) return;
    const payload = dataLines.join('\n');
    dataLines = [];
    if (payload === '') return;

    if (payload === '[DONE]') {
      const finalChunk: InferenceChunk = {
        type: 'done',
        usage,
        attestation,
        billing,
        text: totalText,
        raw: [...raw],
      };
      doneEmitted = true;
      yield finalChunk;
      return;
    }

    const frame = parseDataPayload(payload);
    raw.push(frame);

    // x_0g_trace frame: capture attestation + billing for the eventual 'done'.
    if (frame.x_0g_trace) {
      const trace = frame.x_0g_trace;
      attestation = {
        teeVerified: typeof trace.tee_verified === 'boolean' ? trace.tee_verified : null,
        providerAddress: trace.provider ?? null,
        requestId: trace.request_id ?? null,
      };
      const billingRaw = trace.billing ?? {};
      billing = {
        inputCost: bigintFromWei(billingRaw.input_cost),
        outputCost: bigintFromWei(billingRaw.output_cost),
        totalCost: bigintFromWei(billingRaw.total_cost),
      };
    }

    // Usage-only frame: choices empty + usage present. Capture usage and emit
    // nothing on the chunk side.
    if (
      frame.usage &&
      frame.usage.prompt_tokens !== undefined &&
      frame.usage.completion_tokens !== undefined &&
      frame.usage.total_tokens !== undefined
    ) {
      usage = {
        promptTokens: frame.usage.prompt_tokens,
        completionTokens: frame.usage.completion_tokens,
        totalTokens: frame.usage.total_tokens,
      };
    }

    // Delta-content frame: emit a 'token' chunk if and only if the delta has
    // non-empty content. The very first frame from the Router has empty
    // content + role:assistant — don't emit for that.
    const deltaText = frame.choices?.[0]?.delta?.content;
    if (typeof deltaText === 'string' && deltaText.length > 0) {
      totalText += deltaText;
      // Yield as a fresh literal so callers can't mutate our accumulator.
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      yield { type: 'token', text: deltaText } as InferenceChunk;
    }
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on either CRLF+CRLF (typical SSE) or LF+LF (some transports).
      // To handle partial lines, we walk line-by-line and dispatch on blank
      // lines. We deliberately don't do regex split-on-double-newline so that
      // a `data:` payload that contains escaped JSON newlines (in `\n` form)
      // is unaffected.
      let nlIdx;
      while ((nlIdx = buffer.indexOf('\n')) !== -1) {
        let line = buffer.slice(0, nlIdx);
        buffer = buffer.slice(nlIdx + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);

        if (line === '') {
          // Blank line = event terminator. Flush the accumulated `data:` lines.
          for (const chunk of flushEvent()) {
            yield chunk;
            if (chunk.type === 'done') return;
          }
          continue;
        }
        if (line.startsWith(':')) continue; // SSE comment, skip.
        if (line.startsWith('data:')) {
          const value_ = line.slice(5).replace(/^ /, '');
          dataLines.push(value_);
          continue;
        }
        // Non-data fields (event:, id:, retry:) — Router doesn't use them, but
        // we drop quietly rather than fail.
      }
    }

    // Stream ended. Flush whatever we have buffered as a final event (some
    // servers don't terminate the last event with a blank line).
    if (buffer.length > 0) {
      let line = buffer;
      buffer = '';
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }
    for (const chunk of flushEvent()) {
      yield chunk;
      if (chunk.type === 'done') return;
    }

    // No [DONE] arrived before the stream closed. If we have any accumulated
    // state, synthesize a final 'done' so callers always get one.
    if (!doneEmitted) {
      yield {
        type: 'done',
        usage,
        attestation,
        billing,
        text: totalText,
        raw: [...raw],
      };
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // releaseLock can throw if the reader is already closed; harmless.
    }
  }
}
