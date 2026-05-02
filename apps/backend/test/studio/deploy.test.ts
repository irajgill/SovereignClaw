/**
 * Unit tests for the /studio/deploy + /studio/status routes.
 *
 * We exercise the route handler directly by constructing the Hono app
 * used in production (so CORS, auth, and wiring are all in the blast
 * radius) but we stub the deploy PIPELINE — not the network calls —
 * because live minting is covered by the integration test in
 * apps/backend/test/integration/studio-live.test.ts.
 *
 * Specifically: we instantiate a real `createStudioStore` and a real
 * `studioDeployRoute`, but provide a deployment record pointing at
 * localhost (so any accidental network hit fails fast) and a minter key
 * that is NEVER used because we short-circuit by exercising validation
 * errors and invalid payloads. This keeps the test hermetic.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { studioDeployRoute } from '../../src/studio/deploy.js';
import { studioStatusRoute } from '../../src/studio/status.js';
import { createStudioStore } from '../../src/studio/store.js';

const FAKE_DEPLOYMENT = {
  network: '0g-galileo-testnet',
  chainId: 16602,
  deployer: '0x0000000000000000000000000000000000000abc',
  oracle: '0x0000000000000000000000000000000000000def',
  addresses: {
    AgentNFT: '0xc3f997545da4AA8E70C82Aab82ECB48722740601',
    MemoryRevocation: '0x735084C861E64923576D04d678bA2f89f6fbb6AC',
  },
  explorer: {
    AgentNFT: 'https://chainscan-galileo.0g.ai/address/0xc3f997545da4AA8E70C82Aab82ECB48722740601',
    MemoryRevocation:
      'https://chainscan-galileo.0g.ai/address/0x735084C861E64923576D04d678bA2f89f6fbb6AC',
  },
};

function buildApp() {
  const store = createStudioStore();
  const config = {
    rpcUrl: 'http://127.0.0.1:0', // unreachable on purpose
    indexerUrl: 'http://127.0.0.1:0',
    minterPrivateKey: '0x' + '11'.repeat(32),
    deployment: FAKE_DEPLOYMENT,
    storageExplorerBase: 'https://storagescan-galileo.0g.ai',
  };
  const app = new Hono();
  app.route('/studio', studioDeployRoute({ store, config }));
  app.route('/studio', studioStatusRoute({ store }));
  return { app, store };
}

const MINIMAL_VALID_GRAPH = {
  version: 1,
  nodes: [
    {
      id: 'inf-1',
      kind: 'inference',
      position: { x: 0, y: 0 },
      data: { kind: 'inference', model: 'qwen/qwen-2.5-7b-instruct', verifiable: true },
    },
    {
      id: 'agent-1',
      kind: 'agent',
      position: { x: 100, y: 0 },
      data: { kind: 'agent', role: 'solo', systemPrompt: 'hi' },
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'inf-1',
      target: 'agent-1',
      edgeRole: 'inference',
    },
  ],
};

describe('POST /studio/deploy', () => {
  let app: ReturnType<typeof buildApp>['app'];
  let store: ReturnType<typeof buildApp>['store'];

  beforeEach(() => {
    ({ app, store } = buildApp());
  });

  it('rejects invalid payloads with 400', async () => {
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: {}, code: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid deploy payload/);
  });

  it('accepts a valid payload, returns 202 + deployId, stores a queued job', async () => {
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: MINIMAL_VALID_GRAPH,
        code: 'const x = 1; async function main(){ console.log(x); } main();',
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { deployId: string; status: string };
    expect(body.deployId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.status).toBe('queued');
    expect(store.size()).toBe(1);
    const job = store.get(body.deployId);
    expect(job).toBeDefined();
  });

  it('fails the pipeline fast when the generated code is malformed', async () => {
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code: 'const x: = 1' }),
    });
    expect(res.status).toBe(202);
    const { deployId } = (await res.json()) as { deployId: string };

    // Wait briefly for the async pipeline to advance.
    await new Promise((r) => setTimeout(r, 200));
    const statusRes = await app.request(`/studio/status/${deployId}`);
    expect(statusRes.status).toBe(200);
    const job = (await statusRes.json()) as {
      status: string;
      error?: string;
      logs: Array<{ message: string }>;
    };
    expect(job.status).toBe('error');
    expect(job.error).toMatch(/code bundle rejected/);
    expect(job.logs.some((l) => /parse|unexpected|error/i.test(l.message))).toBe(true);
  });

  it('fails when the graph has no Agent nodes', async () => {
    const graphNoAgents = {
      version: 1,
      nodes: [MINIMAL_VALID_GRAPH.nodes[0]!],
      edges: [],
    };
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: graphNoAgents, code: 'const x = 1' }),
    });
    expect(res.status).toBe(202);
    const { deployId } = (await res.json()) as { deployId: string };
    await new Promise((r) => setTimeout(r, 100));
    const s = (await (await app.request(`/studio/status/${deployId}`)).json()) as {
      status: string;
      error?: string;
    };
    expect(s.status).toBe('error');
    expect(s.error).toMatch(/no agent nodes/);
  });
});

describe('GET /studio/status/:id', () => {
  it('404s on unknown deployIds', async () => {
    const { app } = buildApp();
    const res = await app.request('/studio/status/not-a-real-id');
    expect(res.status).toBe(404);
  });
});
