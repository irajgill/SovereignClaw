import { Hono } from 'hono';
import type { OracleKey } from '../../crypto.js';
import type { BackendConfig } from '../../config.js';

export function pubkeyRoute(opts: { key: OracleKey; config: BackendConfig }) {
  const app = new Hono();
  app.get('/pubkey', (c) =>
    c.json({
      address: opts.key.address,
      chainId: opts.config.deployment.chainId,
      agentNFT: opts.config.deployment.addresses.AgentNFT,
    }),
  );
  return app;
}
