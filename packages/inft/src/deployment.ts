/**
 * Loader for the committed deployment record.
 *
 * Reads `deployments/0g-testnet.json`, validates its shape, returns the
 * addresses callers need. Phase 3+ packages should consume this rather than
 * hardcoding addresses.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAddress } from 'ethers';
import { DeploymentNotFoundError } from './errors.js';

export interface Deployment {
  network: string;
  chainId: number;
  deployer: string;
  oracle: string;
  addresses: {
    AgentNFT: string;
    MemoryRevocation: string;
  };
  explorer: {
    AgentNFT: string;
    MemoryRevocation: string;
  };
}

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the deployment record path. Looks for `deployments/0g-testnet.json`
 * by walking up from this file. Caller can override with an explicit path.
 */
function defaultDeploymentPath(): string {
  // packages/inft/src -> packages/inft -> packages -> repo root
  return resolve(__dirname, '..', '..', '..', 'deployments', '0g-testnet.json');
}

export interface LoadDeploymentOptions {
  /** Explicit JSON file path. Defaults to repo-root deployments/0g-testnet.json. */
  path?: string;
}

export function loadDeployment(opts: LoadDeploymentOptions = {}): Deployment {
  const path = opts.path ?? defaultDeploymentPath();
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new DeploymentNotFoundError(
      `loadDeployment: could not read ${path}. Run \`pnpm deploy:contracts\` first.`,
      { cause: err as Error },
    );
  }
  const parsed = JSON.parse(raw) as Partial<Deployment>;
  if (
    !parsed.chainId ||
    !parsed.addresses ||
    !parsed.addresses.AgentNFT ||
    !parsed.addresses.MemoryRevocation ||
    !parsed.oracle
  ) {
    throw new DeploymentNotFoundError(`loadDeployment: ${path} is missing required fields`);
  }
  for (const [name, addr] of [
    ['AgentNFT', parsed.addresses.AgentNFT],
    ['MemoryRevocation', parsed.addresses.MemoryRevocation],
    ['oracle', parsed.oracle],
  ] as const) {
    if (!isAddress(addr)) {
      throw new DeploymentNotFoundError(`loadDeployment: ${name} is not a valid address: ${addr}`);
    }
  }
  return parsed as Deployment;
}
