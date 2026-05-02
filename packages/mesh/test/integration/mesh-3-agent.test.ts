/**
 * Integration test — full 3-agent planExecuteCritique flow on real 0G Galileo
 * testnet. Opt-in via INTEGRATION=1. Requires RPC_URL, INDEXER_URL,
 * PRIVATE_KEY, COMPUTE_ROUTER_BASE_URL, COMPUTE_ROUTER_API_KEY.
 *
 * This is the Phase 5 DoD artifact: bus events land on 0G Log with 0G root
 * hashes that a reviewer can verify on storagescan-galileo.
 */
import { ethers } from 'ethers';
import { beforeAll, describe, expect, it } from 'vitest';
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { OG_Log, deriveKekFromSigner, encrypted } from '@sovereignclaw/memory';
import { Mesh, planExecuteCritique, BusEventTypes } from '../../src/index.js';

const SHOULD_RUN = process.env.INTEGRATION === '1';
const describeMaybe = SHOULD_RUN ? describe : describe.skip;

describeMaybe('Mesh 3-agent (integration, real testnet)', () => {
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
    'plans, executes, and critiques a small factual task end-to-end',
    async () => {
      const provider = new ethers.JsonRpcProvider(RPC_URL!);
      const signer = new ethers.Wallet(PRIVATE_KEY!, provider);
      const meshId = `mesh-int-${Date.now().toString(36)}`;

      const kek = await deriveKekFromSigner(signer, `${meshId}-bus`);
      const busProvider = encrypted(
        OG_Log({
          namespace: `${meshId}-bus`,
          rpcUrl: RPC_URL!,
          indexerUrl: INDEXER_URL!,
          signer,
        }),
        { kek },
      );
      const mesh = new Mesh({ meshId, provider: busProvider });

      const mk = () =>
        sealed0GInference({
          model: MODEL,
          apiKey: ROUTER_KEY!,
          baseUrl: ROUTER_URL!,
          verifiable: true,
        });

      const planner = new Agent({
        role: 'planner',
        systemPrompt:
          'You decompose questions into short, numbered plans. Do not answer; only plan.',
        inference: mk(),
      });
      const executor = new Agent({
        role: 'executor',
        systemPrompt:
          'You are a careful researcher. Follow the plan step-by-step and produce a concise factual answer.',
        inference: mk(),
      });
      const critic = new Agent({
        role: 'critic',
        systemPrompt:
          'You are a strict reviewer. Output a single JSON object on one line only.',
        inference: mk(),
      });

      try {
        mesh.register(planner).register(executor).register(critic);

        const result = await planExecuteCritique({
          mesh,
          planner,
          executors: [executor],
          critic,
          task: 'What year was the Transformer paper "Attention Is All You Need" published, and by which lab?',
          acceptThreshold: 0.5,
          maxRounds: 2,
        });

        expect(result.finalOutput.length).toBeGreaterThan(10);
        expect(result.rounds).toBeGreaterThanOrEqual(1);
        expect(result.acceptedExecutor).toBe('executor');
        expect(result.eventPointers.length).toBeGreaterThanOrEqual(5);
        for (const pointer of result.eventPointers) {
          expect(pointer).toMatch(/^0x[0-9a-f]{64}$/);
        }

        const events = await mesh.bus.replay();
        expect(events[0]?.type).toBe(BusEventTypes.TaskCreated);
        expect(events[events.length - 1]?.type).toBe(BusEventTypes.TaskComplete);

        // Pretty print for the reviewer — keeps CI logs human-readable.
        console.log(`\n[mesh-int] meshId=${meshId}`);
        console.log(`[mesh-int] finalOutput=${result.finalOutput}`);
        console.log(`[mesh-int] score=${result.score} rounds=${result.rounds}`);
        for (let i = 0; i < result.eventPointers.length; i += 1) {
          console.log(
            `[mesh-int] ${result.eventKeys[i]} root=${result.eventPointers[i]}`,
          );
        }
      } finally {
        await Promise.all([planner.close(), executor.close(), critic.close()]);
        await mesh.close();
      }
    },
    180_000,
  );
});
