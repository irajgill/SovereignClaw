/**
 * POST /studio/deploy
 *
 * Accepts { graph, code } from ClawStudio, runs a small pipeline:
 *   1. zod-validate the payload shape.
 *   2. esbuild-transform the code (reject bad syntax early).
 *   3. Write a canonical deploy manifest to 0G Storage Log and collect
 *      its root hash — the "pointer" for every iNFT below.
 *   4. For each Agent node in the graph, mint an iNFT via
 *      `@sovereignclaw/inft.mintAgentNFT`, using the backend minter key.
 *   5. Update an in-memory DeployJob record so /studio/status can tail.
 *
 * Design choice: we use ONE manifest pointer for ALL agents in the same
 * deploy. This is intentional — every agent in a Studio graph shares a
 * single signed spec; the manifest is the source of truth the iNFT
 * points at. IncomeClaw (Phase 9) will split this into per-agent
 * manifests when agents acquire per-agent memory streams.
 *
 * Authentication: v0 uses the existing `ORACLE_AUTH_TOKEN` bearer check
 * at the Hono middleware level (already wired in server.ts). Browser
 * EIP-712 manifest signing is Phase 7.1 carryover.
 */
import { JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import { Hono } from 'hono';
import type { Logger } from 'pino';
import { mintAgentNFT, type Deployment } from '@sovereignclaw/inft';
import { OG_Log } from '@sovereignclaw/memory';
import { logger as defaultLogger } from '../logger.js';
import { validateCode } from './bundler.js';
import { deployRequest, type DeployRequest } from './types.js';
import type { DeployStore } from './store.js';

export interface StudioConfig {
  rpcUrl: string;
  indexerUrl: string;
  minterPrivateKey: string;
  deployment: Deployment;
  storageExplorerBase?: string;
}

export interface StudioDeps {
  store: DeployStore;
  config: StudioConfig;
  logger?: Logger;
}

export function studioDeployRoute(deps: StudioDeps) {
  const app = new Hono();
  const log = deps.logger ?? defaultLogger;

  app.post('/deploy', async (c) => {
    let payload: DeployRequest;
    try {
      const json = await c.req.json();
      payload = deployRequest.parse(json);
    } catch (err) {
      return c.json({ error: 'invalid deploy payload', detail: (err as Error).message }, 400);
    }

    const graphSha = keccak256(toUtf8Bytes(JSON.stringify(payload.graph)));
    const job = deps.store.create(graphSha);
    log.info({ deployId: job.deployId, graphSha }, 'studio: deploy received');

    // Fire-and-forget pipeline; the client polls /status.
    void runPipeline(payload, job.deployId, deps, log).catch((err) => {
      log.error({ err, deployId: job.deployId }, 'studio: deploy pipeline failed');
      deps.store.update(job.deployId, {
        status: 'error',
        error: err.message ?? String(err),
        finishedAt: Date.now(),
      });
      deps.store.log(job.deployId, 'error', `pipeline failed: ${err.message ?? String(err)}`);
    });

    return c.json({ deployId: job.deployId, status: 'queued' }, 202);
  });

  return app;
}

async function runPipeline(
  payload: DeployRequest,
  deployId: string,
  deps: StudioDeps,
  log: Logger,
): Promise<void> {
  const { store, config } = deps;
  const agents = payload.graph.nodes.filter((n) => n.data.kind === 'agent');
  if (agents.length === 0) {
    store.update(deployId, {
      status: 'error',
      error: 'graph has no agent nodes to mint',
      finishedAt: Date.now(),
    });
    store.log(deployId, 'error', 'no agent nodes found');
    return;
  }

  // 1. esbuild transform validation.
  store.update(deployId, { status: 'bundling' });
  store.log(deployId, 'info', `bundling ${payload.code.length} bytes of generated code`);
  const bundle = await validateCode(payload.code);
  if (!bundle.ok) {
    store.update(deployId, {
      status: 'error',
      error: `code bundle rejected: ${bundle.errors[0]}`,
      finishedAt: Date.now(),
    });
    for (const e of bundle.errors) store.log(deployId, 'error', e);
    return;
  }
  store.log(deployId, 'info', `bundle ok (${bundle.bytes} bytes transformed)`);

  // 2. Write manifest to 0G Storage Log.
  store.update(deployId, { status: 'writing-manifest' });
  const provider = new JsonRpcProvider(config.rpcUrl);
  const minter = new Wallet(config.minterPrivateKey, provider);
  const manifestNamespace = `studio-deploys-${deployId.slice(0, 8)}`;
  const logProvider = OG_Log({
    namespace: manifestNamespace,
    rpcUrl: config.rpcUrl,
    indexerUrl: config.indexerUrl,
    signer: minter,
  });

  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      version: 1,
      deployId,
      generatedAt: Date.now(),
      graph: payload.graph,
      code: payload.code,
      agents: agents.map((a) => ({ nodeId: a.id, role: (a.data as { role: string }).role })),
    }),
  );
  let manifestPointer: string;
  try {
    const result = await logProvider.set('manifest', manifestBytes);
    manifestPointer = result.pointer;
  } catch (err) {
    store.update(deployId, {
      status: 'error',
      error: `manifest write failed: ${(err as Error).message}`,
      finishedAt: Date.now(),
    });
    store.log(deployId, 'error', `manifest write failed: ${(err as Error).message}`);
    await logProvider.close?.();
    return;
  }
  await logProvider.close?.();
  const storageExplorerUrl = config.storageExplorerBase
    ? `${config.storageExplorerBase.replace(/\/$/, '')}/tx/${manifestPointer}`
    : undefined;
  store.update(deployId, { manifestRoot: manifestPointer, storageExplorerUrl });
  store.log(deployId, 'info', `manifest written at ${manifestPointer}`);

  // 3. Mint one iNFT per Agent node, sharing the same pointer.
  store.update(deployId, { status: 'minting' });
  for (const node of agents) {
    const role = (node.data as { role: string }).role;
    store.log(deployId, 'info', `minting iNFT for agent '${role}' (${node.id})`);
    try {
      const result = await mintAgentNFT({
        agent: {
          role,
          getPointer: () => manifestPointer,
        },
        owner: minter,
        wrappedDEK: new Uint8Array(),
        deployment: config.deployment,
      });
      store.setAgent(deployId, {
        nodeId: node.id,
        role,
        tokenId: result.tokenId.toString(),
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
      });
      store.log(
        deployId,
        'info',
        `minted '${role}' as tokenId ${result.tokenId} (tx ${result.txHash.slice(0, 10)}…)`,
      );
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      store.setAgent(deployId, { nodeId: node.id, role });
      store.log(deployId, 'error', `mint '${role}' failed: ${msg}`);
      store.update(deployId, {
        status: 'error',
        error: `mint '${role}' failed: ${msg}`,
        finishedAt: Date.now(),
      });
      return;
    }
  }

  store.update(deployId, { status: 'done', finishedAt: Date.now() });
  store.log(deployId, 'info', `deploy complete: ${agents.length} iNFT(s) minted`);
  log.info({ deployId, agents: agents.length, manifestPointer }, 'studio: deploy complete');
}
