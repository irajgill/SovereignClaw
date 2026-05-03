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
import { HDNodeWallet, Wallet } from 'ethers';
import { generateCode } from '@sovereignclaw/studio/lib/codegen.js';
import {
  STUDIO_DEPLOY_DOMAIN,
  STUDIO_DEPLOY_TYPES,
  computeGraphSha,
} from '../../src/studio/auth.js';
import { codegenEchoDiff, studioDeployRoute } from '../../src/studio/deploy.js';
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

function buildApp(opts: { allowList?: string[] } = {}) {
  const store = createStudioStore();
  const config = {
    rpcUrl: 'http://127.0.0.1:0', // unreachable on purpose
    indexerUrl: 'http://127.0.0.1:0',
    minterPrivateKey: '0x' + '11'.repeat(32),
    deployment: FAKE_DEPLOYMENT,
    storageExplorerBase: 'https://storagescan-galileo.0g.ai',
    auth: {
      allowList: opts.allowList ?? [],
      maxTimestampDriftSec: 300,
    },
  };
  const app = new Hono();
  app.route('/studio', studioDeployRoute({ store, config }));
  app.route('/studio', studioStatusRoute({ store }));
  return { app, store };
}

import type { StudioGraph } from '@sovereignclaw/studio/lib/types.js';

const MINIMAL_VALID_GRAPH: StudioGraph = {
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
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        graph: MINIMAL_VALID_GRAPH,
        code,
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

  it('rejects at the codegen echo step when client code does not match server codegen (Phase 9)', async () => {
    const tampered = generateCode(MINIMAL_VALID_GRAPH).source.replace(
      /"qwen\/qwen-2\.5-7b-instruct"/,
      '"malicious/exfil-model"',
    );
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code: tampered }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toMatch(/does not match server-side codegen/);
    expect(body.detail).toMatch(/line \d+ differs/);
  });

  it('accepts line-ending / trailing-newline drift as semantically equivalent', async () => {
    const canonical = generateCode(MINIMAL_VALID_GRAPH).source;
    const withCrlfAndExtraNewlines = canonical.replace(/\n/g, '\r\n') + '\n\n\n';
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code: withCrlfAndExtraNewlines }),
    });
    expect(res.status).toBe(202);
  });

  it('fails when the graph has no Agent nodes', async () => {
    const graphNoAgents: StudioGraph = {
      version: 1,
      nodes: [MINIMAL_VALID_GRAPH.nodes[0]!],
      edges: [],
    };
    const code = generateCode(graphNoAgents).source;
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: graphNoAgents, code }),
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

describe('POST /studio/deploy wallet auth (Phase 9)', () => {
  async function signFor(
    wallet: Wallet | HDNodeWallet,
    graph: StudioGraph,
    opts: { timestamp?: number } = {},
  ) {
    const claim = {
      graphSha: computeGraphSha(graph),
      nonce: '0x' + '11'.repeat(32),
      timestamp: opts.timestamp ?? Math.floor(Date.now() / 1000),
    };
    const signature = await wallet.signTypedData(STUDIO_DEPLOY_DOMAIN, STUDIO_DEPLOY_TYPES, claim);
    return { address: await wallet.getAddress(), signature, claim };
  }

  it('open mode: accepts unsigned deploys (no allow-list configured)', async () => {
    const { app } = buildApp();
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code }),
    });
    expect(res.status).toBe(202);
  });

  it('closed mode: rejects unsigned deploys with 401', async () => {
    const { app } = buildApp({ allowList: ['0x' + '22'.repeat(20)] });
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toMatch(/no-sig/);
  });

  it('closed mode: accepts a valid signature from an allow-listed address', async () => {
    const wallet = Wallet.createRandom();
    const addr = await wallet.getAddress();
    const { app } = buildApp({ allowList: [addr] });
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    const clientSig = await signFor(wallet, MINIMAL_VALID_GRAPH);
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code, clientSig }),
    });
    expect(res.status).toBe(202);
  });

  it('closed mode: rejects a valid signature from a non-allow-listed wallet with 401', async () => {
    const allowed = Wallet.createRandom();
    const attacker = Wallet.createRandom();
    const { app } = buildApp({ allowList: [await allowed.getAddress()] });
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    const clientSig = await signFor(attacker, MINIMAL_VALID_GRAPH);
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code, clientSig }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toMatch(/not-allowed/);
  });

  it('rejects a signature with a timestamp outside the allowed drift', async () => {
    const wallet = Wallet.createRandom();
    const { app } = buildApp({ allowList: [await wallet.getAddress()] });
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    const stale = await signFor(wallet, MINIMAL_VALID_GRAPH, {
      timestamp: Math.floor(Date.now() / 1000) - 60 * 60,
    });
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code, clientSig: stale }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/timestamp-skew/);
  });

  it('rejects a signature when the graph has been swapped for a different one', async () => {
    const wallet = Wallet.createRandom();
    const { app } = buildApp({ allowList: [await wallet.getAddress()] });
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    // Sign over a DIFFERENT graph, then submit the original.
    const other: StudioGraph = {
      version: 1,
      nodes: [MINIMAL_VALID_GRAPH.nodes[0]!],
      edges: [],
    };
    const mismatch = await signFor(wallet, other);
    const res = await app.request('/studio/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: MINIMAL_VALID_GRAPH, code, clientSig: mismatch }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/graph-mismatch/);
  });
});

describe('codegenEchoDiff (Phase 9)', () => {
  it('returns undefined when client code equals server codegen', () => {
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    expect(codegenEchoDiff({ graph: MINIMAL_VALID_GRAPH, code })).toBeUndefined();
  });

  it('reports the first differing line when the client tampered with a literal', () => {
    const tampered = generateCode(MINIMAL_VALID_GRAPH).source.replace(
      /"qwen\/qwen-2\.5-7b-instruct"/,
      '"malicious/exfil-model"',
    );
    const msg = codegenEchoDiff({ graph: MINIMAL_VALID_GRAPH, code: tampered });
    expect(msg).toMatch(/line \d+ differs/);
    expect(msg).toMatch(/exfil-model/);
  });

  it('reports a length diff when the client appends or truncates', () => {
    const code = generateCode(MINIMAL_VALID_GRAPH).source;
    expect(
      codegenEchoDiff({ graph: MINIMAL_VALID_GRAPH, code: code + 'const sneaky = 1;\n' }),
    ).toMatch(/line \d+ differs|length differs/);
    expect(codegenEchoDiff({ graph: MINIMAL_VALID_GRAPH, code: code.slice(0, -50) })).toBeDefined();
  });
});
