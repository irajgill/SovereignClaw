/**
 * Ad-hoc: exercise the exact deploy path the browser Studio uses, against
 * the live Railway backend, without touching /healthz (which is bearer-
 * gated in production). Simulates the browser origin so we can also
 * verify CORS headers end-to-end.
 *
 * Usage:
 *   STUDIO_BACKEND_URL=https://oracle-production-5db4.up.railway.app \
 *   STUDIO_ORIGIN=https://sovereignclaw-studio.vercel.app \
 *   tsx scripts/smoke-studio-deploy-remote.ts
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
const ORIGIN = process.env.STUDIO_ORIGIN ?? 'http://localhost:3030';
const POLL_INTERVAL_MS = Number(process.env.STUDIO_POLL_INTERVAL_MS ?? 2000);
const POLL_TIMEOUT_MS = Number(process.env.STUDIO_POLL_TIMEOUT_MS ?? 180_000);

async function main(): Promise<void> {
  console.log(`[smoke] backend=${BACKEND}`);
  console.log(`[smoke] origin=${ORIGIN}`);

  console.log('\n[smoke] === CORS preflight ===');
  const pre = await fetch(`${BACKEND}/studio/deploy`, {
    method: 'OPTIONS',
    headers: {
      Origin: ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'Content-Type',
    },
  });
  console.log(`[smoke] preflight: HTTP ${pre.status}`);
  const allowOrigin = pre.headers.get('access-control-allow-origin');
  const allowMethods = pre.headers.get('access-control-allow-methods');
  console.log(`[smoke]   access-control-allow-origin=${allowOrigin}`);
  console.log(`[smoke]   access-control-allow-methods=${allowMethods}`);
  if (!allowOrigin) {
    console.error('[smoke] CORS NOT allowed for this origin — browser would block.');
    process.exit(1);
  }

  console.log('\n[smoke] === seed graph + codegen ===');
  const graph = seedGraph();
  const validation = validateGraph(graph);
  if (!validation.ok) {
    console.error('[smoke] seed graph invalid:', validation.issues);
    process.exit(1);
  }
  const { source } = generateCode(graph);
  console.log(`[smoke] graph=${graph.nodes.length} nodes / ${graph.edges.length} edges`);
  console.log(`[smoke] code=${source.length} bytes`);

  console.log('\n[smoke] === POST /studio/deploy (browser-origin) ===');
  const res = await fetch(`${BACKEND}/studio/deploy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
    },
    body: JSON.stringify({ graph, code: source }),
  });
  const text = await res.text();
  console.log(`[smoke] deploy: HTTP ${res.status}`);
  console.log(`[smoke]   body: ${text.slice(0, 500)}`);
  if (!res.ok) {
    console.error('[smoke] deploy rejected');
    process.exit(1);
  }
  const { deployId } = JSON.parse(text) as { deployId: string; status: string };

  console.log(`\n[smoke] === poll /studio/status/${deployId} ===`);
  const started = Date.now();
  let lastStatus: string | null = null;
  let lastLog = 0;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    const r = await fetch(`${BACKEND}/studio/status/${deployId}`, {
      headers: { Origin: ORIGIN },
    });
    if (!r.ok) {
      console.error(`[smoke] status HTTP ${r.status}`);
      process.exit(1);
    }
    const body = (await r.json()) as {
      status: string;
      error?: string;
      manifestRoot?: string;
      storageExplorerUrl?: string;
      agents: Array<{ role: string; tokenId?: string; txHash?: string; explorerUrl?: string }>;
      logs: Array<{ level: string; message: string }>;
      startedAt: number;
      finishedAt?: number;
    };
    if (body.status !== lastStatus) {
      console.log(`[smoke] status → ${body.status}`);
      lastStatus = body.status;
    }
    for (let i = lastLog; i < body.logs.length; i++) {
      const l = body.logs[i]!;
      console.log(`[smoke]   ${l.level}: ${l.message}`);
    }
    lastLog = body.logs.length;
    if (body.status === 'done') {
      const elapsed = (body.finishedAt ?? Date.now()) - body.startedAt;
      console.log(`\n[smoke] DONE in ${elapsed}ms`);
      if (body.manifestRoot) console.log(`[smoke] manifest=${body.manifestRoot}`);
      if (body.storageExplorerUrl) console.log(`[smoke] ${body.storageExplorerUrl}`);
      for (const a of body.agents) {
        console.log(`[smoke] iNFT ${a.role.padEnd(10)} tokenId=${a.tokenId} tx=${a.txHash}`);
        if (a.explorerUrl) console.log(`[smoke]   ${a.explorerUrl}`);
      }
      return;
    }
    if (body.status === 'error') {
      console.error(`[smoke] deploy FAILED: ${body.error}`);
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  console.error(`[smoke] poll timeout after ${POLL_TIMEOUT_MS}ms`);
  process.exit(1);
}

main().catch((err) => {
  console.error('[smoke] FAILED', err);
  process.exit(1);
});
