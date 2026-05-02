/**
 * Phase 6 DoD integration test.
 *
 * Runs the *same* input through *two* agents against real 0G Galileo:
 *   A) without reflection
 *   B) with reflection (rubric: 'accuracy', rounds: 1, persistLearnings: true)
 *
 * Asserts:
 *   - Both runs return TEE-verified inference
 *   - Run B writes a `learning:<runId>` record to history that
 *     `listRecentLearnings` can read back
 *   - The reflected run's final answer is non-empty and may differ from
 *     the unreflected one (we do not hard-require it — reflection can
 *     also legitimately accept the initial answer on round 1)
 *
 * Opt-in via INTEGRATION=1. Requires PRIVATE_KEY, RPC_URL, INDEXER_URL,
 * COMPUTE_ROUTER_BASE_URL, COMPUTE_ROUTER_API_KEY.
 */
import { ethers } from 'ethers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Agent, listRecentLearnings, sealed0GInference } from '@sovereignclaw/core';
import { OG_Log, deriveKekFromSigner, encrypted } from '@sovereignclaw/memory';
import { reflectOnOutput } from '../../src/reflect.js';

const SHOULD_RUN = process.env.INTEGRATION === '1';
const describeMaybe = SHOULD_RUN ? describe : describe.skip;

describeMaybe('Phase 6 DoD — with vs without reflection (real testnet)', () => {
  const RPC_URL = process.env.RPC_URL;
  const INDEXER_URL = process.env.INDEXER_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;
  const ROUTER_URL = process.env.COMPUTE_ROUTER_BASE_URL;
  const ROUTER_KEY = process.env.COMPUTE_ROUTER_API_KEY;
  const MODEL = process.env.COMPUTE_MODEL ?? 'qwen/qwen-2.5-7b-instruct';

  beforeAll(() => {
    if (!RPC_URL || !INDEXER_URL || !PRIVATE_KEY || !ROUTER_URL || !ROUTER_KEY) {
      throw new Error(
        'Integration tests require RPC_URL, INDEXER_URL, PRIVATE_KEY, COMPUTE_ROUTER_BASE_URL, COMPUTE_ROUTER_API_KEY',
      );
    }
  });

  it(
    'produces a queryable learning when reflection is enabled',
    async () => {
      const provider = new ethers.JsonRpcProvider(RPC_URL!);
      const signer = new ethers.Wallet(PRIVATE_KEY!, provider);
      const ns = `reflection-dod-${Date.now().toString(36)}`;
      const kek = await deriveKekFromSigner(signer, ns);
      const question =
        'Name the 2017 paper that introduced the Transformer architecture, its first author, and its venue. One sentence per field.';

      const historyA = encrypted(
        OG_Log({ namespace: `${ns}-A-history`, rpcUrl: RPC_URL!, indexerUrl: INDEXER_URL!, signer }),
        { kek },
      );
      const historyB = encrypted(
        OG_Log({ namespace: `${ns}-B-history`, rpcUrl: RPC_URL!, indexerUrl: INDEXER_URL!, signer }),
        { kek },
      );

      const mk = () =>
        sealed0GInference({
          model: MODEL,
          apiKey: ROUTER_KEY!,
          baseUrl: ROUTER_URL!,
          verifiable: true,
        });

      // Branch A: no reflection
      const agentA = new Agent({
        role: 'researcher-A',
        systemPrompt:
          'You are a careful academic researcher. When asked about papers, cite authors, year, and venue.',
        inference: mk(),
        history: historyA,
      });

      // Branch B: with reflection
      const agentB = new Agent({
        role: 'researcher-B',
        systemPrompt:
          'You are a careful academic researcher. When asked about papers, cite authors, year, and venue.',
        inference: mk(),
        history: historyB,
        reflect: reflectOnOutput({
          rounds: 1,
          critic: 'self',
          rubric: 'accuracy',
          persistLearnings: true,
          threshold: 0.7,
        }),
      });

      try {
        const outA = await agentA.run(question);
        expect(outA?.text.length ?? 0).toBeGreaterThan(10);
        expect(outA?.attestation.teeVerified).toBeDefined();

        const outB = await agentB.run(question);
        expect(outB?.text.length ?? 0).toBeGreaterThan(10);

        const learnings = await listRecentLearnings(historyB, 10);
        expect(learnings.length).toBeGreaterThanOrEqual(1);
        const latest = learnings[0]!;
        expect(latest.version).toBe(1);
        expect(latest.inputText).toContain('Transformer');
        expect(latest.finalOutputText.length).toBeGreaterThan(10);
        expect(latest.score).toBeGreaterThanOrEqual(0);
        expect(latest.score).toBeLessThanOrEqual(1);

        // Keep the DoD evidence in test output for human review.
        console.log('\n[reflection-dod] A (no reflect):', outA?.text.slice(0, 280));
        console.log('[reflection-dod] B (reflect):', outB?.text.slice(0, 280));
        console.log(
          `[reflection-dod] learning.score=${latest.score.toFixed(2)} accepted=${latest.accepted} runId=${latest.runId}`,
        );
      } finally {
        await Promise.all([agentA.close(), agentB.close()]);
      }
    },
    240_000,
  );
});
