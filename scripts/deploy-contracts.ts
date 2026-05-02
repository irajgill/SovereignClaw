/**
 * Phase 2 deploy wrapper.
 *
 * Runs `forge script Deploy.s.sol --broadcast` against 0G Galileo Testnet,
 * parses the broadcast JSON output, and writes deployments/0g-testnet.json
 * with addresses, tx hashes, explorer URLs, and a verification placeholder.
 *
 * Verification of source on chainscan-galileo.0g.ai is invoked separately
 * via `forge verify-contract` — see contracts/README.md.
 *
 *   pnpm deploy:contracts
 *
 * Required env (loaded from .env via dotenv):
 *   PRIVATE_KEY     — funded testnet wallet (deployer + admin)
 *   ORACLE_ADDRESS  — initial oracle address (rotatable later)
 *   RPC_URL         — 0G Galileo testnet RPC
 *   CHAIN_ID        — must equal 16602
 *   EXPLORER_URL    — chainscan base URL
 *
 * The broadcast file is read from contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const CONTRACTS_DIR = resolve(REPO_ROOT, 'contracts');
const DEPLOYMENTS_DIR = resolve(REPO_ROOT, 'deployments');

interface BroadcastTx {
  hash: string | null;
  contractName: string | null;
  contractAddress: string | null;
  function: string | null;
  transactionType: string;
}

interface BroadcastFile {
  transactions: BroadcastTx[];
  receipts: Array<{ transactionHash: string; status: string }>;
  timestamp: number;
  chain: number;
}

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployedAt: string;
  deployer: string;
  oracle: string;
  txHashes: { MemoryRevocation: string; AgentNFT: string };
  addresses: { MemoryRevocation: string; AgentNFT: string };
  explorer: { MemoryRevocation: string; AgentNFT: string };
  verified: { MemoryRevocation: boolean; AgentNFT: boolean };
}

function resolveOracleAddress(deployer: string): string {
  const raw = process.env.ORACLE_ADDRESS;
  if (!raw || /_replace_with_/i.test(raw)) {
    logger.warn(
      { deployer },
      'deploy: ORACLE_ADDRESS unset; using deployer as placeholder oracle. Phase 3 rotates via setOracle.',
    );
    return deployer;
  }
  if (!ethers.isAddress(raw)) throw new Error(`ORACLE_ADDRESS is not a valid address: ${raw}`);
  if (raw.toLowerCase() === ethers.ZeroAddress.toLowerCase()) {
    throw new Error('ORACLE_ADDRESS cannot be zero');
  }
  return ethers.getAddress(raw);
}

function broadcastForge(env: ReturnType<typeof loadEnv>, oracle: string): void {
  const args = [
    'script',
    'script/Deploy.s.sol:Deploy',
    '--broadcast',
    '--rpc-url',
    env.RPC_URL,
    '--slow',
  ];
  logger.info({ rpc: env.RPC_URL, oracle }, 'deploy: invoking forge script');
  const res = spawnSync('forge', args, {
    cwd: CONTRACTS_DIR,
    stdio: 'inherit',
    env: {
      ...process.env,
      PRIVATE_KEY: env.PRIVATE_KEY,
      ORACLE_ADDRESS: oracle,
    },
  });
  if (res.status !== 0) {
    throw new Error(`forge script exited ${res.status ?? '?'}; see output above`);
  }
}

function readBroadcast(chainId: number): BroadcastFile {
  const path = resolve(
    CONTRACTS_DIR,
    'broadcast',
    'Deploy.s.sol',
    String(chainId),
    'run-latest.json',
  );
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    throw new Error(`deploy: could not read broadcast file at ${path}: ${(err as Error).message}`);
  }
  return JSON.parse(raw) as BroadcastFile;
}

function extractAddresses(broadcast: BroadcastFile): {
  registry: { addr: string; tx: string };
  agentNFT: { addr: string; tx: string };
} {
  const findCreate = (name: string): { addr: string; tx: string } => {
    const tx = broadcast.transactions.find(
      (t) => t.transactionType === 'CREATE' && t.contractName === name,
    );
    if (!tx || !tx.contractAddress || !tx.hash) {
      throw new Error(`deploy: could not find CREATE tx for ${name} in broadcast`);
    }
    return { addr: ethers.getAddress(tx.contractAddress), tx: tx.hash };
  };
  return {
    registry: findCreate('MemoryRevocation'),
    agentNFT: findCreate('AgentNFT'),
  };
}

async function verifyOnChain(
  env: ReturnType<typeof loadEnv>,
  addrs: { registry: string; agentNFT: string },
): Promise<void> {
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  for (const [name, addr] of Object.entries(addrs)) {
    const code = await provider.getCode(addr);
    if (code === '0x') {
      throw new Error(`deploy: ${name} at ${addr} has no bytecode on-chain`);
    }
  }
  logger.info('deploy: verified bytecode present at both addresses');
}

function writeDeploymentRecord(
  env: ReturnType<typeof loadEnv>,
  oracle: string,
  deployer: string,
  registry: { addr: string; tx: string },
  agentNFT: { addr: string; tx: string },
): string {
  mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const record: DeploymentRecord = {
    network: '0g-galileo-testnet',
    chainId: env.CHAIN_ID,
    deployedAt: new Date().toISOString(),
    deployer,
    oracle,
    txHashes: { MemoryRevocation: registry.tx, AgentNFT: agentNFT.tx },
    addresses: { MemoryRevocation: registry.addr, AgentNFT: agentNFT.addr },
    explorer: {
      MemoryRevocation: `${env.EXPLORER_URL}/address/${registry.addr}`,
      AgentNFT: `${env.EXPLORER_URL}/address/${agentNFT.addr}`,
    },
    verified: { MemoryRevocation: false, AgentNFT: false },
  };
  const out = resolve(DEPLOYMENTS_DIR, '0g-testnet.json');
  writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  logger.info({ path: out }, 'deploy: wrote deployment record');
  return out;
}

async function main(): Promise<void> {
  const env = loadEnv();
  if (env.CHAIN_ID !== 16602) {
    throw new Error(`deploy: expected CHAIN_ID=16602 (0G Galileo), got ${env.CHAIN_ID}`);
  }
  const deployer = new ethers.Wallet(env.PRIVATE_KEY).address;
  const oracle = resolveOracleAddress(deployer);

  broadcastForge(env, oracle);
  const broadcast = readBroadcast(env.CHAIN_ID);
  const { registry, agentNFT } = extractAddresses(broadcast);
  await verifyOnChain(env, { registry: registry.addr, agentNFT: agentNFT.addr });
  const out = writeDeploymentRecord(env, oracle, deployer, registry, agentNFT);

  logger.info(
    {
      MemoryRevocation: registry.addr,
      AgentNFT: agentNFT.addr,
      record: out,
    },
    'deploy: phase-2 contracts deployed',
  );
}

main().catch((err) => {
  logger.error({ err }, 'deploy failed');
  process.exit(1);
});
