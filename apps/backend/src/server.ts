/**
 * SovereignClaw backend entrypoint.
 *
 * Phase 3 surface: dev oracle (pubkey, prove, reencrypt, revoke).
 * Phase 7 surface: studio deploy pipeline (POST /studio/deploy,
 * GET /studio/status/:id).
 *
 * Both feature sets share auth middleware (optional bearer token) and
 * the same process lifecycle. The studio routes are enabled only when a
 * minter key is configured; otherwise they reject with 503 so the UI
 * surfaces a clear message instead of minting with an empty wallet.
 */
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { loadConfig } from './config.js';
import { loadOracleKey } from './crypto.js';
import { logger } from './logger.js';
import { createInMemoryStore } from './store.js';
import { pubkeyRoute } from './routes/oracle/pubkey.js';
import { proveRoute } from './routes/oracle/prove.js';
import { reencryptRoute } from './routes/oracle/reencrypt.js';
import { revokeRoute } from './routes/oracle/revoke.js';
import { studioDeployRoute } from './studio/deploy.js';
import { studioStatusRoute } from './studio/status.js';
import { createStudioStore } from './studio/store.js';

export function buildApp(deps: ReturnType<typeof buildDeps>) {
  const app = new Hono();
  const { config, key, store, studioStore } = deps;

  // CORS for the browser Studio (Next.js dev server).
  const corsOriginsRaw =
    config.STUDIO_CORS_ORIGINS ?? 'http://localhost:3030,http://127.0.0.1:3030';
  const allowList = new Set(
    corsOriginsRaw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  );
  app.use('*', async (c, next) => {
    const origin = c.req.header('Origin');
    if (origin && allowList.has(origin)) {
      c.header('Access-Control-Allow-Origin', origin);
      c.header('Vary', 'Origin');
      c.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
      c.header(
        'Access-Control-Allow-Headers',
        c.req.header('Access-Control-Request-Headers') ?? 'Content-Type,Authorization',
      );
    }
    if (c.req.method === 'OPTIONS') return c.body(null, 204);
    return next();
  });

  // Optional bearer token gate. Applies to ALL routes; /healthz still
  // requires the token if one is set.
  app.use('*', async (c, next) => {
    if (!config.ORACLE_AUTH_TOKEN) return next();
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${config.ORACLE_AUTH_TOKEN}`) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  });

  const studioEnabled =
    Boolean(config.RPC_URL) &&
    Boolean(config.INDEXER_URL) &&
    Boolean(config.STUDIO_MINTER_PRIVATE_KEY ?? config.PRIVATE_KEY);

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      oracleAddress: key.address,
      hasKey: true,
      chainId: config.deployment.chainId,
      agentNFT: config.deployment.addresses.AgentNFT,
      revokedCount: store.size(),
      studio: {
        enabled: studioEnabled,
        deploys: studioStore.size(),
      },
    }),
  );

  app.route('/oracle', pubkeyRoute({ key, config }));
  app.route('/oracle', proveRoute({ key, config }));
  app.route('/oracle', reencryptRoute({ key, config, store }));
  app.route('/oracle', revokeRoute({ key, config, store }));

  if (studioEnabled) {
    const minterKey = (config.STUDIO_MINTER_PRIVATE_KEY ?? config.PRIVATE_KEY)!;
    const studioConfig = {
      rpcUrl: config.RPC_URL!,
      indexerUrl: config.INDEXER_URL!,
      minterPrivateKey: minterKey,
      deployment: config.deployment,
      storageExplorerBase: config.STORAGE_EXPLORER_URL,
    };
    app.route('/studio', studioDeployRoute({ store: studioStore, config: studioConfig, logger }));
    app.route('/studio', studioStatusRoute({ store: studioStore }));
  } else {
    app.all('/studio/*', (c) =>
      c.json(
        {
          error:
            'studio disabled: set RPC_URL, INDEXER_URL and STUDIO_MINTER_PRIVATE_KEY (or PRIVATE_KEY) in backend env',
        },
        503,
      ),
    );
  }

  return app;
}

export function buildDeps() {
  const config = loadConfig();
  const key = loadOracleKey(config.ORACLE_PRIVATE_KEY);
  const store = createInMemoryStore();
  const studioStore = createStudioStore();
  return { config, key, store, studioStore };
}

async function main() {
  const deps = buildDeps();
  const app = buildApp(deps);
  const port = deps.config.PORT;

  serve({ fetch: app.fetch, port }, (info) => {
    logger.info(
      {
        port: info.port,
        oracleAddress: deps.key.address,
        agentNFT: deps.config.deployment.addresses.AgentNFT,
        chainId: deps.config.deployment.chainId,
        studioEnabled:
          Boolean(deps.config.RPC_URL) &&
          Boolean(deps.config.INDEXER_URL) &&
          Boolean(deps.config.STUDIO_MINTER_PRIVATE_KEY ?? deps.config.PRIVATE_KEY),
      },
      'sovereignclaw backend up',
    );
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    logger.error({ err: err.message ?? String(err) }, 'backend failed to start');
    process.exit(1);
  });
}
