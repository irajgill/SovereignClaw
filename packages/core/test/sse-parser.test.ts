/**
 * Unit tests for the SSE parser. No network — synthetic byte streams only.
 *
 * The parser is responsible for turning the exact wire format observed from
 * the 0G Compute Router (captured in the dev-log, also visible by curl with
 * `stream:true`) into a sequence of `InferenceChunk`s. The fixture data here
 * is byte-identical to that wire format.
 */
import { describe, expect, it } from 'vitest';
import { parseSSEStream } from '../src/sse-parser.js';
import { StreamInterruptedError } from '../src/errors.js';
import type { InferenceChunk } from '../src/sse-parser.js';

/** Build a ReadableStream<Uint8Array> from a string OR an array of byte
 *  chunks. Used to simulate TCP fragmentation. */
function streamFrom(input: string | string[]): ReadableStream<Uint8Array> {
  const chunks = Array.isArray(input) ? input : [input];
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
}

async function collect(stream: ReadableStream<Uint8Array>): Promise<InferenceChunk[]> {
  const out: InferenceChunk[] = [];
  for await (const chunk of parseSSEStream(stream)) {
    out.push(chunk);
  }
  return out;
}

const DELTA_FRAME = (text: string): string =>
  `data: ${JSON.stringify({
    choices: [{ delta: { content: text }, index: 0, finish_reason: null, logprobs: null }],
    object: 'chat.completion.chunk',
    usage: null,
    created: 1777806101,
    model: 'qwen2.5-7b-instruct',
    id: 'chatcmpl-test',
    system_fingerprint: null,
  })}\n\n`;

const STOP_FRAME = `data: ${JSON.stringify({
  choices: [{ delta: { content: '' }, index: 0, finish_reason: 'stop', logprobs: null }],
  object: 'chat.completion.chunk',
  usage: null,
  created: 1777806101,
  model: 'qwen2.5-7b-instruct',
  id: 'chatcmpl-test',
  system_fingerprint: null,
})}\n\n`;

const USAGE_FRAME = `data: ${JSON.stringify({
  choices: [],
  object: 'chat.completion.chunk',
  usage: { prompt_tokens: 21, completion_tokens: 9, total_tokens: 30 },
  created: 1777806101,
  model: 'qwen2.5-7b-instruct',
  id: 'chatcmpl-test',
  system_fingerprint: null,
})}\n\n`;

const TRACE_FRAME = `data: ${JSON.stringify({
  x_0g_trace: {
    request_id: '107cefb0-daaf-4517-b5ec-352bb1e4a6cf',
    provider: '0xa48f01287233509FD694a22Bf840225062E67836',
    billing: {
      input_cost: '1050000000000',
      output_cost: '900000000000',
      total_cost: '1950000000000',
    },
    tee_verified: true,
  },
})}\n\n`;

const DONE_FRAME = `data: [DONE]\n\n`;

describe('parseSSEStream', () => {
  it('parses a well-formed multi-chunk stream into the expected InferenceChunks', async () => {
    const wire =
      DELTA_FRAME('') + // role:assistant frame, empty content — must NOT emit a token chunk
      DELTA_FRAME('Hello') +
      DELTA_FRAME(' world') +
      STOP_FRAME +
      USAGE_FRAME +
      TRACE_FRAME +
      DONE_FRAME;

    const chunks = await collect(streamFrom(wire));
    const tokens = chunks.filter((c) => c.type === 'token') as Array<{
      type: 'token';
      text: string;
    }>;
    expect(tokens.map((t) => t.text)).toEqual(['Hello', ' world']);

    const done = chunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    if (done?.type !== 'done') throw new Error('unreachable');

    expect(done.text).toBe('Hello world');
    expect(done.usage).toEqual({ promptTokens: 21, completionTokens: 9, totalTokens: 30 });
    expect(done.attestation).toEqual({
      teeVerified: true,
      providerAddress: '0xa48f01287233509FD694a22Bf840225062E67836',
      requestId: '107cefb0-daaf-4517-b5ec-352bb1e4a6cf',
    });
    expect(done.billing).toEqual({
      inputCost: 1050000000000n,
      outputCost: 900000000000n,
      totalCost: 1950000000000n,
    });
    // Last chunk yielded is the 'done'; iterator terminates after it.
    expect(chunks[chunks.length - 1]).toBe(done);
  });

  it('handles streams split across arbitrary byte boundaries', async () => {
    const wire =
      DELTA_FRAME('one') +
      DELTA_FRAME('two') +
      DELTA_FRAME('three') +
      USAGE_FRAME +
      TRACE_FRAME +
      DONE_FRAME;

    // Slice into 7-byte chunks to simulate TCP fragmentation. Every other
    // byte boundary lands inside a JSON payload, header, or newline — so the
    // parser must handle partial lines correctly.
    const slices: string[] = [];
    for (let i = 0; i < wire.length; i += 7) {
      slices.push(wire.slice(i, i + 7));
    }

    const chunks = await collect(streamFrom(slices));
    const tokens = chunks.filter((c) => c.type === 'token') as Array<{
      type: 'token';
      text: string;
    }>;
    expect(tokens.map((t) => t.text)).toEqual(['one', 'two', 'three']);
    const done = chunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    if (done?.type !== 'done') throw new Error('unreachable');
    expect(done.text).toBe('onetwothree');
    expect(done.usage?.totalTokens).toBe(30);
  });

  it('treats [DONE] as terminal regardless of where it appears', async () => {
    // [DONE] mid-stream must end iteration; later frames are ignored.
    const wire =
      DELTA_FRAME('A') +
      DONE_FRAME +
      DELTA_FRAME('B') + // should never be emitted
      USAGE_FRAME;

    const chunks = await collect(streamFrom(wire));
    const tokens = chunks.filter((c) => c.type === 'token') as Array<{
      type: 'token';
      text: string;
    }>;
    expect(tokens.map((t) => t.text)).toEqual(['A']);
    expect(chunks[chunks.length - 1]?.type).toBe('done');
    // The [DONE] frame closed the iterator, so 'B' is never emitted.
    expect(chunks.filter((c) => c.type === 'token')).toHaveLength(1);
  });

  it('drops SSE comment lines without emitting chunks', async () => {
    const wire =
      `: keepalive ping\n\n` +
      DELTA_FRAME('hello') +
      `: another comment\n\n` +
      DELTA_FRAME(' world') +
      DONE_FRAME;

    const chunks = await collect(streamFrom(wire));
    const tokens = chunks.filter((c) => c.type === 'token') as Array<{
      type: 'token';
      text: string;
    }>;
    expect(tokens.map((t) => t.text)).toEqual(['hello', ' world']);
  });

  it('throws StreamInterruptedError on a malformed JSON line', async () => {
    const wire =
      DELTA_FRAME('ok') +
      `data: {not valid json\n\n` + // malformed
      DONE_FRAME;

    await expect(async () => {
      for await (const _ of parseSSEStream(streamFrom(wire))) {
        void _;
      }
    }).rejects.toBeInstanceOf(StreamInterruptedError);
  });

  it('synthesizes a final done chunk when the stream closes without [DONE]', async () => {
    const wire = DELTA_FRAME('part') + USAGE_FRAME; // no DONE_FRAME

    const chunks = await collect(streamFrom(wire));
    const tokens = chunks.filter((c) => c.type === 'token') as Array<{
      type: 'token';
      text: string;
    }>;
    expect(tokens.map((t) => t.text)).toEqual(['part']);

    const done = chunks.find((c) => c.type === 'done');
    expect(done).toBeDefined();
    if (done?.type !== 'done') throw new Error('unreachable');
    expect(done.text).toBe('part');
    expect(done.usage?.totalTokens).toBe(30);
  });

  it('handles CRLF line endings as well as LF', async () => {
    const wire = DELTA_FRAME('one').replace(/\n/g, '\r\n') + DONE_FRAME.replace(/\n/g, '\r\n');

    const chunks = await collect(streamFrom(wire));
    const tokens = chunks.filter((c) => c.type === 'token') as Array<{
      type: 'token';
      text: string;
    }>;
    expect(tokens.map((t) => t.text)).toEqual(['one']);
  });

  it('captures attestation with teeVerified=null when the trace omits the field', async () => {
    const traceWithoutTee = `data: ${JSON.stringify({
      x_0g_trace: { request_id: 'r1', provider: '0xprov' },
    })}\n\n`;
    const wire = DELTA_FRAME('hi') + traceWithoutTee + DONE_FRAME;
    const chunks = await collect(streamFrom(wire));
    const done = chunks.find((c) => c.type === 'done');
    if (done?.type !== 'done') throw new Error('unreachable');
    expect(done.attestation?.teeVerified).toBeNull();
    expect(done.attestation?.providerAddress).toBe('0xprov');
  });
});
