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
  /** 0G RPC URL used by Studio deploy pipeline for manifest writes + minting. */
  RPC_URL: z.string().url().optional(),
  /** 0G Storage indexer for manifest writes. */
  INDEXER_URL: z.string().url().optional(),
  /** 0G storage explorer base for manifest links (e.g. https://storagescan-galileo.0g.ai). */
  STORAGE_EXPLORER_URL: z.string().url().optional(),
  /**
   * Funded wallet used to mint iNFTs on behalf of Studio deploys.
   * If unset, /studio/deploy returns 503.
   * Falls back to PRIVATE_KEY so the existing .env keeps working in v0.
   */
  STUDIO_MINTER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'STUDIO_MINTER_PRIVATE_KEY must be 0x + 64 hex chars')
    .optional(),
  PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'PRIVATE_KEY must be 0x + 64 hex chars')
    .optional(),
  /** CSV of origins allowed to hit /studio/*; defaults to http://localhost:3030. */
  STUDIO_CORS_ORIGINS: z.string().optional(),
  /**
   * Phase 9: CSV of addresses allowed to submit signed /studio/deploy
   * requests. When unset or empty, the backend runs in OPEN MODE and
   * accepts unsigned deploys (suitable for local dev only). When set,
   * the signer recovered from each request's EIP-712 signature must be
   * in this list or the request returns 401.
   */
  STUDIO_SIGNER_ALLOWLIST: z.string().optional(),
  /**
   * Phase 9: max allowed drift between `clientSig.claim.timestamp` and
   * server now, in seconds. Defaults to 300 (±5 min). Lower is safer;
   * too low fails when the client clock is out of sync.
   */
  STUDIO_SIGNATURE_MAX_DRIFT_SEC: z.coerce.number().int().positive().default(300),
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
