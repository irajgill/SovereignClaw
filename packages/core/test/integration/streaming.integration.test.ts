/**
 * Phase B PR1 integration test — streaming inference against real 0G Router.
 *
 * Hits `qwen/qwen-2.5-7b-instruct` on the live 0G Compute Router with
 * `stream: true, verify_tee: true`. Asserts:
 *   - ≥10 token chunks arrive before the 'done' chunk
 *   - InferenceResult.text equals the concatenation of all token chunks
 *   - InferenceResult.attestation.teeVerified is observed (logs whether
 *     true / false / null so the caller can see the live Router state)
 *   - onChunk fires in the same order as the stream chunks
 *
 * Skips with a clear message if INTEGRATION != '1' or required env is missing.
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { sealed0GInference, type InferenceChunk } from '../../src/index.js';

const RUN = process.env.INTEGRATION === '1';
const HAVE_KEY = !!process.env.COMPUTE_ROUTER_API_KEY;
const skip = !RUN || !HAVE_KEY;

describe.skipIf(skip)('streaming inference (real 0G Router)', () => {
  beforeAll(() => {
    if (!process.env.COMPUTE_ROUTER_API_KEY) {
      throw new Error('COMPUTE_ROUTER_API_KEY missing — cannot run streaming integration test');
    }
  });

  it('emits ≥10 token chunks, returns concatenated text matching the stream, surfaces teeVerified', async () => {
    const adapter = sealed0GInference({
      model: 'qwen/qwen-2.5-7b-instruct',
      apiKey: process.env.COMPUTE_ROUTER_API_KEY!,
      baseUrl: process.env.COMPUTE_ROUTER_BASE_URL,
      verifiable: true,
      timeoutMs: 60_000,
    });

    const chunkOrder: InferenceChunk[] = [];
    const tokens: string[] = [];

    const result = await adapter.run(
      [
        {
          role: 'user',
          content:
            'Write a single short paragraph (3-4 sentences) explaining what a TEE is in plain English. Plain prose, no list.',
        },
      ],
      {
        stream: true,
        maxTokens: 200,
        onChunk: (chunk) => {
          chunkOrder.push(chunk);
          if (chunk.type === 'token') tokens.push(chunk.text);
        },
      },
    );

    // Per-chunk assertions
    const tokenCount = tokens.length;
    // eslint-disable-next-line no-console
    console.log(
      `[streaming.integration] tokens=${tokenCount} text.length=${result.text.length} teeVerified=${result.attestation.teeVerified} provider=${result.attestation.providerAddress}`,
    );
    expect(tokenCount, `expected ≥10 token chunks, got ${tokenCount}`).toBeGreaterThanOrEqual(10);

    // Final result.text equals concatenation of all token chunks.
    expect(result.text).toBe(tokens.join(''));
    expect(result.text.length).toBeGreaterThan(40);

    // Order: every token chunk arrived before the done chunk.
    const doneIdx = chunkOrder.findIndex((c) => c.type === 'done');
    expect(doneIdx).toBeGreaterThan(0);
    const firstNonTokenAfterTokens = chunkOrder
      .slice(0, doneIdx)
      .findIndex((c) => c.type !== 'token');
    expect(
      firstNonTokenAfterTokens,
      'no chunks of type other than token should appear before done',
    ).toBe(-1);

    // Attestation: teeVerified observed. The Router we tested in Phase A and
    // the curl smoke at the start of Phase B both returned true; allow null
    // (field absent) for forward-compat but log loudly so the caller sees it.
    const tee = result.attestation.teeVerified;
    expect([true, false, null]).toContain(tee);
    if (tee === null) {
      // eslint-disable-next-line no-console
      console.warn(
        '[streaming.integration] teeVerified came back null — Router did not include x_0g_trace.tee_verified in the streaming response',
      );
    } else {
      expect(typeof tee).toBe('boolean');
    }
    expect(result.attestation.requestId).toBeTruthy();

    // Billing came through.
    expect(result.billing.totalCost).toBeGreaterThan(0n);

    // Latency was measured end-to-end (start of request to last chunk).
    expect(result.latencyMs).toBeGreaterThan(0);
    expect(result.latencyMs).toBeLessThan(60_000);
  }, 120_000);
});
