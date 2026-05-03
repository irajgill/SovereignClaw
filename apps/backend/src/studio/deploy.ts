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
// Deep import: @sovereignclaw/studio is "private" and doesn't publish its
// own library entry. lib/codegen.ts is a pure function with no React
// imports. We resolve it lazily via a dynamic import so the Studio module
// never has to load at backend boot — in production (Studio disabled) the
// import is never reached, so the deployed container does not need to
// carry the Studio source. In dev (Studio enabled) the workspace symlink
// resolves it as before. Keep this import path narrow so we never
// accidentally drag Next.js into the backend build.
interface CodegenResult {
  source: string;
  imports: Record<string, string[]>;
}
type GenerateCode = (graph: unknown) => CodegenResult;
let cachedGenerateCode: GenerateCode | undefined;
async function loadGenerateCode(): Promise<GenerateCode> {
  if (cachedGenerateCode) return cachedGenerateCode;
  const mod = (await import('@sovereignclaw/studio/lib/codegen.js')) as {
    generateCode: GenerateCode;
  };
  cachedGenerateCode = mod.generateCode;
  return cachedGenerateCode;
}
import { logger as defaultLogger } from '../logger.js';
import { verifyStudioDeploy, type StudioAuthConfig } from './auth.js';
import { validateCode } from './bundler.js';
import { deployRequest, type DeployRequest } from './types.js';
import type { DeployStore } from './store.js';

export interface StudioConfig {
  rpcUrl: string;
  indexerUrl: string;
  minterPrivateKey: string;
  deployment: Deployment;
  storageExplorerBase?: string;
  /**
   * Phase 9: deploy auth. When `allowList` is non-empty, the deploy
   * route requires a valid EIP-712 `clientSig` whose recovered signer is
   * in the list. When empty, the route accepts unsigned requests (dev
   * mode) and server.ts logs a warning.
   */
  auth: StudioAuthConfig;
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

    // EIP-712 wallet auth (Phase 9). When STUDIO_SIGNER_ALLOWLIST is
    // set, an unsigned or mis-signed request is rejected with 401 before
    // we spend any CPU on codegen diff or esbuild.
    const auth = verifyStudioDeploy(payload.graph, payload.clientSig, deps.config.auth);
    if (!auth.ok) {
      log.warn({ code: auth.code, detail: auth.detail }, 'studio: auth rejected');
      const httpStatus = auth.code === 'no-sig' || auth.code === 'not-allowed' ? 401 : 400;
      return c.json({ error: `deploy rejected: ${auth.code}`, detail: auth.detail }, httpStatus);
    }
    if (auth.open && payload.clientSig) {
      log.info({ signer: auth.signer }, 'studio: open-mode deploy from signed client');
    } else if (auth.open) {
      log.info('studio: open-mode deploy (no STUDIO_SIGNER_ALLOWLIST configured)');
    }

    // Codegen echo diff (Phase 9). We re-run the canonical `generateCode`
    // against the graph and compare to the client-submitted source after
    // whitespace normalization. This prevents a malicious client from
    // rendering one thing in Monaco and uploading a tampered source
    // string — without it, an attacker could swap out the inference
    // adapter, exfiltrate keys, etc. before esbuild ever sees the code.
    // We tolerate trailing-newline and CRLF drift because those are not
    // semantically meaningful, but reject on anything else.
    const echoIssue = await codegenEchoDiff(payload);
    if (echoIssue) {
      log.warn({ reason: echoIssue }, 'studio: rejecting deploy: code/graph mismatch');
      return c.json(
        {
          error: 'deploy rejected: submitted code does not match server-side codegen of the graph',
          detail: echoIssue,
        },
        400,
      );
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

/**
 * Normalize generated TS source before byte-comparison. The rules here
 * are intentionally strict: we only forgive line-ending style and a
 * single trailing newline, because those are artefacts of the caller's
 * editor and carry no semantics. Anything else — renamed symbols,
 * re-ordered agents, swapped inference adapter, etc. — is rejected.
 */
function normalizeSource(s: string): string {
  return s.replace(/\r\n/g, '\n').replace(/\n+$/, '\n');
}

/**
 * Re-run `generateCode(graph)` on the server and compare to the client
 * submission. Returns `undefined` when they match, otherwise a short
 * human-readable reason suitable for 400 responses + audit logs.
 *
 * Exported for unit-testability.
 */
export async function codegenEchoDiff(payload: DeployRequest): Promise<string | undefined> {
  let expected: string;
  try {
    const generateCode = await loadGenerateCode();
    const out = generateCode(payload.graph);
    expected = out.source;
  } catch (err) {
    return `server-side codegen threw: ${(err as Error).message}`;
  }
  const got = normalizeSource(payload.code);
  const want = normalizeSource(expected);
  if (got === want) return undefined;
  // Report the first differing line number + short slice to help the
  // operator triage without leaking the whole source into logs.
  const gotLines = got.split('\n');
  const wantLines = want.split('\n');
  const max = Math.max(gotLines.length, wantLines.length);
  for (let i = 0; i < max; i++) {
    if (gotLines[i] !== wantLines[i]) {
      const g = (gotLines[i] ?? '<eof>').slice(0, 120);
      const w = (wantLines[i] ?? '<eof>').slice(0, 120);
      return `line ${i + 1} differs: client=${JSON.stringify(g)} server=${JSON.stringify(w)}`;
    }
  }
  return `code length differs (client=${got.length}, server=${want.length})`;
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
