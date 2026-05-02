/**
 * SovereignClaw backend entrypoint. Phase 3 surface: dev oracle.
 *
 * Phase 7 will add `/studio/*` routes; the structure leaves room.
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

export function buildApp(deps: ReturnType<typeof buildDeps>) {
  const app = new Hono();
  const { config, key, store } = deps;

  // Optional bearer token gate
  app.use('*', async (c, next) => {
    if (!config.ORACLE_AUTH_TOKEN) return next();
    const auth = c.req.header('Authorization');
    if (auth !== `Bearer ${config.ORACLE_AUTH_TOKEN}`) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  });

  app.get('/healthz', (c) =>
    c.json({
      ok: true,
      oracleAddress: key.address,
      hasKey: true,
      chainId: config.deployment.chainId,
      agentNFT: config.deployment.addresses.AgentNFT,
      revokedCount: store.size(),
    }),
  );

  app.route('/oracle', pubkeyRoute({ key, config }));
  app.route('/oracle', proveRoute({ key, config }));
  app.route('/oracle', reencryptRoute({ key, config, store }));
  app.route('/oracle', revokeRoute({ key, config, store }));

  return app;
}

export function buildDeps() {
  const config = loadConfig();
  const key = loadOracleKey(config.ORACLE_PRIVATE_KEY);
  const store = createInMemoryStore();
  return { config, key, store };
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
      },
      'oracle backend up',
    );
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    logger.error({ err: err.message ?? String(err) }, 'oracle backend failed to start');
    process.exit(1);
  });
}
