/**
 * sealed0GInference - the inference adapter for @sovereignclaw/core.
 *
 * Wraps the 0G Compute Router and surfaces typed attestation, billing, usage,
 * latency, and text result data.
 *
 * v0.2.0 adds an opt-in streaming branch via `stream: true`. The non-streaming
 * branch is unchanged at the wire level — same headers, same body shape, same
 * response parsing — so all v0.1.x consumers continue to work without churn.
 */
import {
  DirectModeUnsupportedError,
  EmptyInferenceResponseError,
  InferenceTimeoutError,
  RouterAuthError,
  RouterBalanceError,
  RouterClientError,
  RouterServerError,
  StreamInterruptedError,
} from './errors.js';
import { parseSSEStream, type InferenceChunk } from './sse-parser.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  verifiable?: boolean;
  providerHint?: Record<string, unknown>;
  timeoutMs?: number;
  retries?: { count: number; backoffMs: number };
  depositUrl?: string;
  providerAddress?: never;
}

export interface BillingInfo {
  inputCost: bigint;
  outputCost: bigint;
  totalCost: bigint;
}

export interface Attestation {
  teeVerified: boolean | null;
  providerAddress: string | null;
  requestId: string | null;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface InferenceResult {
  model: string;
  text: string;
  usage?: TokenUsage;
  attestation: Attestation;
  billing: BillingInfo;
  latencyMs: number;
  raw: unknown;
}

/**
 * Per-call options accepted by `InferenceAdapter.run()`. Adding `stream`,
 * `onChunk`, and `signal` is additive vs v0.1.x — callers that pass only
 * `maxTokens`/`temperature` continue to behave exactly as before.
 */
export interface RunOptions {
  maxTokens?: number;
  temperature?: number;
  /** Opt-in SSE streaming. When true, the adapter posts with `stream:true`
   *  and parses `text/event-stream`. Default `false`. */
  stream?: boolean;
  /** Called for every InferenceChunk as it arrives. Only invoked when
   *  `stream === true`. Throwing inside the callback aborts the stream and
   *  surfaces as a StreamInterruptedError. */
  onChunk?: (chunk: InferenceChunk) => void;
  /** Caller-supplied AbortSignal. The adapter installs its own timeout signal
   *  on top; whichever fires first aborts the request. */
  signal?: AbortSignal;
}

/**
 * Streaming-only run options used by Agent.run(). The brief calls for a
 * dedicated `StreamRunOptions` symbol so consumers can author streaming sites
 * without conditional types — `onChunk` is required here, not optional.
 */
export interface StreamRunOptions {
  maxTokens?: number;
  temperature?: number;
  /** Required: callback for each chunk as it arrives. */
  onChunk: (chunk: InferenceChunk) => void;
  signal?: AbortSignal;
}

export interface InferenceAdapter {
  run(messages: ChatMessage[], options?: RunOptions): Promise<InferenceResult>;
}

interface RouterResponse {
  id?: string;
  model?: string;
  object?: string;
  created?: number;
  choices?: Array<{
    index?: number;
    finish_reason?: string;
    message?: { role?: string; content?: string };
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

const DEFAULT_BASE_URL = 'https://router-api-testnet.integratenetwork.work/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DEPOSIT_URL = 'https://pc.testnet.0g.ai';

function bigintFromWei(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function sealed0GInference(opts: InferenceOptions): InferenceAdapter {
  const providerAddressValue = (opts as unknown as { providerAddress?: unknown }).providerAddress;
  if (providerAddressValue !== undefined) {
    throw new DirectModeUnsupportedError('providerAddress');
  }

  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const verifiable = opts.verifiable ?? true;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const depositUrl = opts.depositUrl ?? DEFAULT_DEPOSIT_URL;
  const retryCount = opts.retries?.count ?? 2;
  const retryBackoffMs = opts.retries?.backoffMs ?? 500;

  return {
    async run(messages, runOpts): Promise<InferenceResult> {
      const url = `${baseUrl}/chat/completions`;
      const wantStream = runOpts?.stream === true;
      const body: Record<string, unknown> = {
        model: opts.model,
        messages,
        max_tokens: runOpts?.maxTokens ?? 512,
        temperature: runOpts?.temperature ?? 0,
        stream: wantStream,
      };
      if (verifiable) body.verify_tee = true;
      if (opts.providerHint) body.provider = opts.providerHint;

      const start = Date.now();

      if (wantStream) {
        const result = await streamWithRetry({
          url,
          body,
          apiKey: opts.apiKey,
          timeoutMs,
          retryCount,
          retryBackoffMs,
          depositUrl,
          modelHint: opts.model,
          onChunk: runOpts?.onChunk,
          externalSignal: runOpts?.signal,
        });
        return {
          ...result,
          latencyMs: Date.now() - start,
        };
      }

      const data = await callWithRetry({
        url,
        body,
        apiKey: opts.apiKey,
        timeoutMs,
        retryCount,
        retryBackoffMs,
        depositUrl,
        externalSignal: runOpts?.signal,
      });
      const latencyMs = Date.now() - start;

      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) {
        throw new EmptyInferenceResponseError(JSON.stringify(data));
      }

      const trace = data.x_0g_trace ?? {};
      const billingRaw = trace.billing ?? {};

      return {
        model: data.model ?? opts.model,
        text,
        usage:
          data.usage?.prompt_tokens !== undefined &&
          data.usage?.completion_tokens !== undefined &&
          data.usage?.total_tokens !== undefined
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              }
            : undefined,
        attestation: {
          teeVerified: typeof trace.tee_verified === 'boolean' ? trace.tee_verified : null,
          providerAddress: trace.provider ?? null,
          requestId: trace.request_id ?? null,
        },
        billing: {
          inputCost: bigintFromWei(billingRaw.input_cost),
          outputCost: bigintFromWei(billingRaw.output_cost),
          totalCost: bigintFromWei(billingRaw.total_cost),
        },
        latencyMs,
        raw: data,
      };
    },
  };
}

interface CallArgs {
  url: string;
  body: Record<string, unknown>;
  apiKey: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  depositUrl: string;
  externalSignal?: AbortSignal;
}

async function callWithRetry(args: CallArgs): Promise<RouterResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= args.retryCount; attempt += 1) {
    try {
      return await callOnce(args);
    } catch (err) {
      if (
        err instanceof RouterAuthError ||
        err instanceof RouterBalanceError ||
        err instanceof RouterClientError ||
        err instanceof EmptyInferenceResponseError
      ) {
        throw err;
      }
      lastError = err;
      if (attempt < args.retryCount) {
        const backoff = args.retryBackoffMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

async function callOnce(args: CallArgs): Promise<RouterResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  if (args.externalSignal) {
    if (args.externalSignal.aborted) controller.abort();
    else args.externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new InferenceTimeoutError(args.timeoutMs, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (args.externalSignal) {
      args.externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    if (res.status === 401) throw new RouterAuthError(undefined);
    if (res.status === 402) throw new RouterBalanceError(args.depositUrl);
    if (res.status >= 500) throw new RouterServerError(res.status, text);
    throw new RouterClientError(res.status, text);
  }

  return (await res.json()) as RouterResponse;
}

// ---------------------------------------------------------------------------
// streaming
// ---------------------------------------------------------------------------

interface StreamCallArgs extends CallArgs {
  modelHint: string;
  onChunk?: (chunk: InferenceChunk) => void;
}

interface StreamCompleteResult {
  model: string;
  text: string;
  usage?: TokenUsage;
  attestation: Attestation;
  billing: BillingInfo;
  raw: unknown;
}

async function streamWithRetry(args: StreamCallArgs): Promise<StreamCompleteResult> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= args.retryCount; attempt += 1) {
    try {
      return await streamOnce(args);
    } catch (err) {
      // Mid-stream errors are final per §19.7 — never retry once we've started
      // emitting tokens.
      if (err instanceof StreamInterruptedError) throw err;
      // Permanent client/auth/balance errors don't benefit from retry.
      if (
        err instanceof RouterAuthError ||
        err instanceof RouterBalanceError ||
        err instanceof RouterClientError ||
        err instanceof EmptyInferenceResponseError
      ) {
        throw err;
      }
      lastError = err;
      if (attempt < args.retryCount) {
        const backoff = args.retryBackoffMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

async function streamOnce(args: StreamCallArgs): Promise<StreamCompleteResult> {
  // Connection-only timeout: the timer fires until first byte; once we have a
  // body to read, we cancel it. Long stream durations don't accidentally
  // expire (per spec).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  const onExternalAbort = (): void => controller.abort();
  if (args.externalSignal) {
    if (args.externalSignal.aborted) controller.abort();
    else args.externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (args.externalSignal) {
      args.externalSignal.removeEventListener('abort', onExternalAbort);
    }
    if (err instanceof Error && err.name === 'AbortError') {
      throw new InferenceTimeoutError(args.timeoutMs, { cause: err });
    }
    throw err;
  }

  // First byte received → kill the connection timer. Mid-stream stalls remain
  // bounded by the underlying fetch's transport timeout; for an explicit
  // total-stream cap callers wire their own AbortSignal via `signal:`.
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    if (args.externalSignal) {
      args.externalSignal.removeEventListener('abort', onExternalAbort);
    }
    if (res.status === 401) throw new RouterAuthError(undefined);
    if (res.status === 402) throw new RouterBalanceError(args.depositUrl);
    if (res.status >= 500) throw new RouterServerError(res.status, text);
    throw new RouterClientError(res.status, text);
  }

  if (!res.body) {
    if (args.externalSignal) {
      args.externalSignal.removeEventListener('abort', onExternalAbort);
    }
    throw new StreamInterruptedError('Router returned an empty body for a stream request');
  }

  let finalChunk: Extract<InferenceChunk, { type: 'done' }> | undefined;

  try {
    for await (const chunk of parseSSEStream(res.body)) {
      if (args.onChunk) {
        try {
          args.onChunk(chunk);
        } catch (err) {
          throw new StreamInterruptedError(
            `onChunk callback threw: ${(err as Error).message ?? String(err)}`,
            { cause: err },
          );
        }
      }
      if (chunk.type === 'done') {
        finalChunk = chunk;
        break;
      }
    }
  } finally {
    if (args.externalSignal) {
      args.externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  if (!finalChunk) {
    throw new StreamInterruptedError('stream ended without a done chunk');
  }
  if (!finalChunk.text) {
    throw new EmptyInferenceResponseError(
      `streaming response yielded no token text. raw=${JSON.stringify(finalChunk.raw).slice(0, 200)}`,
    );
  }

  const attestation: Attestation = finalChunk.attestation ?? {
    teeVerified: null,
    providerAddress: null,
    requestId: null,
  };
  const billing: BillingInfo = finalChunk.billing ?? {
    inputCost: 0n,
    outputCost: 0n,
    totalCost: 0n,
  };

  return {
    model: args.modelHint,
    text: finalChunk.text,
    usage: finalChunk.usage,
    attestation,
    billing,
    raw: finalChunk.raw,
  };
}
