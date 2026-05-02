/**
 * Smoke test: end-to-end Studio deploy against a running backend.
 *
 * Prereq: backend is up at $STUDIO_BACKEND_URL (default http://localhost:8787).
 *
 *   pnpm --filter @sovereignclaw/backend dev   # terminal 1
 *   pnpm smoke:studio                          # terminal 2
 *
 * Flow:
 *   1. Load the seed 3-agent research swarm graph from @sovereignclaw/studio.
 *   2. Generate SovereignClaw code via pure codegen.
 *   3. POST { graph, code } to /studio/deploy.
 *   4. Poll /studio/status/:id until `done` or `error`.
 *   5. Log manifest pointer + per-agent iNFT explorer links.
 *
 * Exits 0 on `done`, 1 on `error` or polling timeout.
 *
 * This doubles as the live DoD for Phase 7: a single command that mints
 * real iNFTs on 0G Galileo, reproducing what the browser Deploy button
 * does under the hood.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(here, '..', '.env');
if (existsSync(envPath)) loadDotenv({ path: envPath });

import { generateCode } from '../packages/studio/lib/codegen.js';
import { seedGraph } from '../packages/studio/lib/seed-graph.js';
import { validateGraph } from '../packages/studio/lib/validator.js';

const BACKEND = process.env.STUDIO_BACKEND_URL ?? 'http://localhost:8787';
const POLL_INTERVAL_MS = Number(process.env.STUDIO_POLL_INTERVAL_MS ?? 2000);
const POLL_TIMEOUT_MS = Number(process.env.STUDIO_POLL_TIMEOUT_MS ?? 180_000);

interface StatusBody {
  deployId: string;
  status: 'queued' | 'validating' | 'bundling' | 'writing-manifest' | 'minting' | 'done' | 'error';
  error?: string;
  manifestRoot?: string;
  storageExplorerUrl?: string;
  agents: Array<{
    nodeId: string;
    role: string;
    tokenId?: string;
    txHash?: string;
    explorerUrl?: string;
  }>;
  logs: Array<{ at: number; level: string; message: string }>;
  startedAt: number;
  finishedAt?: number;
}

async function waitForBackend(): Promise<void> {
  const res = await fetch(`${BACKEND}/healthz`).catch(() => null);
  if (!res || !res.ok) {
    throw new Error(
      `backend not reachable at ${BACKEND} (is pnpm --filter @sovereignclaw/backend dev running?)`,
    );
  }
  const body = (await res.json()) as { studio?: { enabled?: boolean } };
  if (!body.studio?.enabled) {
    throw new Error(
      'backend is up but studio routes are disabled; check RPC_URL/INDEXER_URL/PRIVATE_KEY',
    );
  }
}

async function postDeploy(): Promise<string> {
  const graph = seedGraph();
  const validation = validateGraph(graph);
  if (!validation.ok) {
    console.error('seed graph failed validation:', validation.issues);
    process.exit(1);
  }
  const { source } = generateCode(graph);
  console.log(`[smoke] seed graph ok: ${graph.nodes.length} nodes / ${graph.edges.length} edges`);
  console.log(`[smoke] generated ${source.length} bytes of TypeScript`);
  const res = await fetch(`${BACKEND}/studio/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ graph, code: source }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`deploy POST ${res.status}: ${text}`);
  }
  const body = (await res.json()) as { deployId: string; status: string };
  console.log(`[smoke] queued deployId=${body.deployId} status=${body.status}`);
  return body.deployId;
}

async function poll(deployId: string): Promise<StatusBody> {
  const started = Date.now();
  let lastLogIndex = 0;
  let lastStatus: string | null = null;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const res = await fetch(`${BACKEND}/studio/status/${deployId}`);
    if (!res.ok) {
      throw new Error(`status ${res.status}`);
    }
    const body = (await res.json()) as StatusBody;
    if (body.status !== lastStatus) {
      console.log(`[smoke] status → ${body.status}`);
      lastStatus = body.status;
    }
    for (let i = lastLogIndex; i < body.logs.length; i++) {
      const l = body.logs[i]!;
      console.log(`[smoke]   ${l.level}: ${l.message}`);
    }
    lastLogIndex = body.logs.length;
    if (body.status === 'done' || body.status === 'error') {
      return body;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`poll timeout after ${POLL_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  await waitForBackend();
  const deployId = await postDeploy();
  const final = await poll(deployId);

  if (final.status === 'error') {
    console.error(`\n[smoke] deploy FAILED: ${final.error}`);
    process.exit(1);
  }

  const elapsed = (final.finishedAt ?? Date.now()) - final.startedAt;
  console.log(`\n[smoke] deploy DONE in ${elapsed}ms`);
  if (final.manifestRoot) {
    console.log(`[smoke] manifest root: ${final.manifestRoot}`);
    if (final.storageExplorerUrl) console.log(`[smoke]   ${final.storageExplorerUrl}`);
  }
  for (const a of final.agents) {
    console.log(`[smoke] iNFT ${a.role.padEnd(10)} tokenId=${a.tokenId} tx=${a.txHash}`);
    if (a.explorerUrl) console.log(`[smoke]   ${a.explorerUrl}`);
  }
}

main().catch((err) => {
  console.error('[smoke] FAILED', err);
  process.exit(1);
});
