/**
 * Backend configuration loaded once at startup. Validates the env up front;
 * a missing/typoed key is a startup failure, not a 500 mid-request.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load env from the closest .env: prefer repo root (when running in
// dev / monorepo), fall back to cwd, fall back to apps/backend/.env.
{
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '..', '..', '.env'),
    resolve(process.cwd(), '.env'),
    resolve(here, '..', '.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path });
      break;
    }
  }
}
import { isAddress } from 'ethers';
import type { Deployment } from '@sovereignclaw/inft';
import { loadDeployment } from '@sovereignclaw/inft';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  ORACLE_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'ORACLE_PRIVATE_KEY must be 0x + 64 hex chars'),
  /** Optional bearer token. If unset, the oracle accepts unauthenticated calls. Document this clearly. */
  ORACLE_AUTH_TOKEN: z.string().optional(),
  /** Path to deployments/0g-testnet.json. Defaults to repo root. */
  DEPLOYMENT_PATH: z.string().optional(),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type RawConfig = z.infer<typeof ConfigSchema>;

export interface BackendConfig extends RawConfig {
  deployment: Deployment;
}

export function loadConfig(): BackendConfig {
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid backend env:\n${issues}`);
  }
  const raw = parsed.data;
  const deployment = loadDeployment({ path: raw.DEPLOYMENT_PATH });
  if (!isAddress(deployment.addresses.AgentNFT)) {
    throw new Error('Deployment.AgentNFT is not a valid address');
  }
  return { ...raw, deployment };
}
