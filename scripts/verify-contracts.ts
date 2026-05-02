/**
 * Phase 2 verification wrapper.
 *
 * Reads deployments/0g-testnet.json and invokes `forge verify-contract`
 * against the chainscan-galileo.0g.ai Blockscout-compatible verifier for
 * each deployed contract. Updates the `verified` flags on success.
 *
 *   pnpm verify:contracts
 *
 * If verification fails (network error, unsupported compiler, etc.),
 * the script logs the failure and continues; manual flattened-source
 * upload via the explorer UI is the documented fallback (see
 * contracts/README.md).
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CONTRACTS_DIR = resolve(REPO_ROOT, 'contracts');
const DEPLOYMENT_PATH = resolve(REPO_ROOT, 'deployments', '0g-testnet.json');

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  oracle: string;
  addresses: { MemoryRevocation: string; AgentNFT: string };
  verified: { MemoryRevocation: boolean; AgentNFT: boolean };
  [k: string]: unknown;
}

interface VerifyTarget {
  name: keyof DeploymentRecord['verified'];
  address: string;
  contractPath: string;
  encodedConstructorArgs: string;
}

function loadRecord(): DeploymentRecord {
  return JSON.parse(readFileSync(DEPLOYMENT_PATH, 'utf8')) as DeploymentRecord;
}

function buildTargets(record: DeploymentRecord): VerifyTarget[] {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder();
  // MemoryRevocation(address agentNFT)
  const revArgs = abiCoder.encode(['address'], [record.addresses.AgentNFT]);
  // AgentNFT(address registry, address oracle, string name, string symbol)
  const nftArgs = abiCoder.encode(
    ['address', 'address', 'string', 'string'],
    [
      record.addresses.MemoryRevocation,
      record.oracle,
      'SovereignClaw Agent',
      'SCAGENT',
    ],
  );
  return [
    {
      name: 'MemoryRevocation',
      address: record.addresses.MemoryRevocation,
      contractPath: 'src/MemoryRevocation.sol:MemoryRevocation',
      encodedConstructorArgs: revArgs,
    },
    {
      name: 'AgentNFT',
      address: record.addresses.AgentNFT,
      contractPath: 'src/AgentNFT.sol:AgentNFT',
      encodedConstructorArgs: nftArgs,
    },
  ];
}

function verifyOne(target: VerifyTarget, env: ReturnType<typeof loadEnv>): boolean {
  const verifierUrl = `${env.EXPLORER_URL.replace(/\/$/, '')}/api`;
  const args = [
    'verify-contract',
    target.address,
    target.contractPath,
    '--rpc-url',
    env.RPC_URL,
    '--verifier',
    'blockscout',
    '--verifier-url',
    verifierUrl,
    '--constructor-args',
    target.encodedConstructorArgs,
    '--watch',
  ];
  logger.info({ target: target.name, address: target.address, verifierUrl }, 'verify: invoking forge');
  const res = spawnSync('forge', args, { cwd: CONTRACTS_DIR, stdio: 'inherit' });
  return res.status === 0;
}

function main(): void {
  const env = loadEnv();
  const record = loadRecord();
  if (record.chainId !== env.CHAIN_ID) {
    throw new Error(`verify: deployment chainId ${record.chainId} != env CHAIN_ID ${env.CHAIN_ID}`);
  }

  const targets = buildTargets(record);
  for (const t of targets) {
    const ok = verifyOne(t, env);
    record.verified[t.name] = ok;
    if (!ok) {
      logger.warn(
        { target: t.name },
        'verify: failed; fall back to manual flattened-source upload (see contracts/README.md)',
      );
    }
  }

  writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(record, null, 2)}\n`);
  logger.info({ path: DEPLOYMENT_PATH, verified: record.verified }, 'verify: updated record');
}

main();
