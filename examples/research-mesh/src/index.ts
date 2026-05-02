/**
 * ResearchMesh — Phase 5 Definition-of-Done example.
 *
 * Three-agent mesh: planner → executor → critic, coordinated over a bus
 * backed by encrypted 0G Log. Runs the `planExecuteCritique` pattern for a
 * single task, then prints:
 *   - every bus event with its type, seq, fromAgent, and 0G root-hash pointer
 *   - the final accepted output, score, and round count
 *   - storagescan links for the bus events so reviewers can verify
 *
 * Everything on-chain / on-log is ciphertext — only the wallet that derived
 * the KEK can decrypt the bus. This satisfies Phase 5 DoD:
 *   "demonstrable 3-agent flow on testnet with bus events visible on indexer."
 *
 * Prereqs (same as ResearchClaw):
 *   - `.env` at repo root with PRIVATE_KEY, RPC_URL, INDEXER_URL,
 *     COMPUTE_ROUTER_BASE_URL, COMPUTE_ROUTER_API_KEY, COMPUTE_MODEL.
 *   - PRIVATE_KEY wallet funded on 0G Galileo.
 *   - `pnpm --filter @sovereignclaw/core --filter @sovereignclaw/memory --filter @sovereignclaw/mesh build`
 *     run at least once.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

{
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '.env'),
    resolve(here, '..', '..', '..', '.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path });
      break;
    }
  }
}

import { JsonRpcProvider, Wallet } from 'ethers';
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { OG_Log, deriveKekFromSigner, encrypted } from '@sovereignclaw/memory';
import { Mesh, planExecuteCritique, type BusEvent } from '@sovereignclaw/mesh';

const KEK_NAMESPACE = process.env.KEK_NAMESPACE ?? 'research-mesh-v1';
const STORAGE_EXPLORER = process.env.STORAGE_EXPLORER_URL ?? 'https://storagescan-galileo.0g.ai';
const DEFAULT_TASK =
  'Name the 2017 paper that introduced the Transformer architecture, its authors, and venue. One sentence per field.';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function log(step: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ step, ...data }, null, 2));
}

async function main(): Promise<void> {
  const RPC_URL = required('RPC_URL');
  const INDEXER_URL = required('INDEXER_URL');
  const PRIVATE_KEY = required('PRIVATE_KEY');
  const ROUTER_URL = required('COMPUTE_ROUTER_BASE_URL');
  const ROUTER_KEY = required('COMPUTE_ROUTER_API_KEY');
  const MODEL = process.env.COMPUTE_MODEL ?? 'qwen/qwen-2.5-7b-instruct';
  const task = process.argv.slice(2).join(' ').trim() || DEFAULT_TASK;

  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);
  const meshId = `${KEK_NAMESPACE}-${Date.now().toString(36)}`;

  log('start', {
    meshId,
    owner: signer.address,
    model: MODEL,
    indexer: INDEXER_URL,
    namespace: KEK_NAMESPACE,
  });

  const kek = await deriveKekFromSigner(signer, `${KEK_NAMESPACE}-bus`);
  const busProvider = encrypted(
    OG_Log({
      namespace: `${KEK_NAMESPACE}-bus-${meshId}`,
      rpcUrl: RPC_URL,
      indexerUrl: INDEXER_URL,
      signer,
    }),
    { kek },
  );
  const mesh = new Mesh({ meshId, provider: busProvider });

  const makeInference = () =>
    sealed0GInference({
      model: MODEL,
      apiKey: ROUTER_KEY,
      baseUrl: ROUTER_URL,
      verifiable: true,
    });

  const planner = new Agent({
    role: 'planner',
    systemPrompt:
      'You decompose research questions into short, numbered plans. Each step is concrete and verifiable. Do not answer the question yourself — only plan.',
    inference: makeInference(),
  });

  const executor = new Agent({
    role: 'executor',
    systemPrompt:
      'You are a careful researcher. You follow the plan step-by-step and produce a complete, well-sourced answer. Cite authors, years, and venue when relevant.',
    inference: makeInference(),
  });

  const critic = new Agent({
    role: 'critic',
    systemPrompt:
      'You are a strict academic reviewer. You grade answers on factual accuracy against the rubric. You only output a single-line JSON object.',
    inference: makeInference(),
  });

  mesh.register(planner).register(executor).register(critic);
  mesh.on((event: BusEvent) => {
    log('bus.event', {
      seq: event.seq,
      type: event.type,
      from: event.fromAgent,
      parentSeq: event.parentSeq ?? null,
    });
  });

  log('task', { task });

  const started = Date.now();
  const result = await planExecuteCritique({
    mesh,
    planner,
    executors: [executor],
    critic,
    task,
    acceptThreshold: 0.7,
    maxRounds: 2,
  });
  const elapsedMs = Date.now() - started;

  console.log('\n=== ResearchMesh output ===');
  console.log(result.finalOutput);
  console.log('===========================\n');

  log('result', {
    rounds: result.rounds,
    score: Number(result.score.toFixed(3)),
    acceptedExecutor: result.acceptedExecutor,
    elapsedMs,
    eventCount: result.eventPointers.length,
  });

  // Emit per-event storagescan links so reviewers can verify on the indexer.
  // Format: https://storagescan-galileo.0g.ai/tx/<rootHash> resolves to the
  // storage upload; the indexer also exposes search by root hash directly.
  console.log('\n=== Bus events on 0G (verifiable) ===');
  for (let i = 0; i < result.eventPointers.length; i += 1) {
    const key = result.eventKeys[i];
    const pointer = result.eventPointers[i];
    console.log(`${key}  root=${pointer}  ${STORAGE_EXPLORER}/tx/${pointer}`);
  }
  console.log('=====================================\n');

  // Sanity: replay the bus and confirm the final event is task.complete.
  const replayed = await mesh.bus.replay();
  const last = replayed[replayed.length - 1];
  log('replay.check', {
    total: replayed.length,
    firstType: replayed[0]?.type,
    lastType: last?.type,
    lastSeq: last?.seq,
  });

  await Promise.all([planner.close(), executor.close(), critic.close()]);
  await mesh.close();
  log('done', {
    summary:
      '3-agent mesh completed. Every bus event is encrypted on 0G Log and verifiable via its 0G root hash on storagescan-galileo.',
  });
}

main().catch((err) => {
  console.error('\nresearch-mesh: FAILED');
  console.error(err);
  process.exit(1);
});
