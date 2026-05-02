/**
 * Rotate AgentNFT.oracle to a new address.
 *
 * Usage:
 *   ORACLE_NEW_ADDRESS=0x... pnpm rotate:oracle
 *
 * Reads the deployer wallet from PRIVATE_KEY (must equal AgentNFT.owner()).
 * Calls AgentNFT.setOracle(newAddr). On success, updates
 * deployments/0g-testnet.json `oracle` field and writes a `oracleHistory`
 * append-only log inside the same JSON.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Contract, JsonRpcProvider, Wallet, isAddress, ZeroAddress } from 'ethers';

const require_ = createRequire(import.meta.url);
const AgentNFTAbi = (require_('../contracts/out/AgentNFT.sol/AgentNFT.json') as { abi: unknown[] })
  .abi;
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const DEPLOYMENT_PATH = resolve(REPO_ROOT, 'deployments', '0g-testnet.json');

interface Record {
  network: string;
  chainId: number;
  deployer: string;
  oracle: string;
  addresses: { AgentNFT: string; MemoryRevocation: string };
  oracleHistory?: Array<{ from: string; to: string; txHash: string; at: string }>;
  [k: string]: unknown;
}

async function main() {
  const env = loadEnv();
  const newOracle = process.env.ORACLE_NEW_ADDRESS;
  if (!newOracle) throw new Error('ORACLE_NEW_ADDRESS env var is required');
  if (!isAddress(newOracle) || newOracle === ZeroAddress) {
    throw new Error(`ORACLE_NEW_ADDRESS is not a valid non-zero address: ${newOracle}`);
  }

  const record = JSON.parse(readFileSync(DEPLOYMENT_PATH, 'utf8')) as Record;
  if (record.chainId !== env.CHAIN_ID) {
    throw new Error(`chainId mismatch: record=${record.chainId} env=${env.CHAIN_ID}`);
  }
  if (record.oracle.toLowerCase() === newOracle.toLowerCase()) {
    logger.warn(
      { oracle: record.oracle },
      'rotate-oracle: oracle already set to that address; nothing to do',
    );
    return;
  }

  const provider = new JsonRpcProvider(env.RPC_URL);
  const wallet = new Wallet(env.PRIVATE_KEY, provider);
  const nft = new Contract(record.addresses.AgentNFT, AgentNFTAbi as never, wallet) as unknown as {
    owner: () => Promise<string>;
    oracle: () => Promise<string>;
    setOracle: (
      newOracle: string,
    ) => Promise<{ hash: string; wait: () => Promise<{ blockNumber: number } | null> }>;
  };

  const owner = await nft.owner();
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`rotate-oracle: signer ${wallet.address} is not the AgentNFT owner ${owner}`);
  }
  const previous = await nft.oracle();
  logger.info({ previous, next: newOracle }, 'rotate-oracle: submitting setOracle tx');

  const tx = await nft.setOracle(newOracle);
  logger.info({ tx: tx.hash }, 'rotate-oracle: submitted; waiting for confirmation');
  const receipt = await tx.wait();
  if (!receipt) throw new Error('rotate-oracle: receipt missing');

  const updated: Record = {
    ...record,
    oracle: newOracle,
    oracleHistory: [
      ...(record.oracleHistory ?? []),
      { from: previous, to: newOracle, txHash: tx.hash, at: new Date().toISOString() },
    ],
  };
  writeFileSync(DEPLOYMENT_PATH, `${JSON.stringify(updated, null, 2)}\n`);
  logger.info(
    { oracle: newOracle, txHash: tx.hash, explorer: `${env.EXPLORER_URL}/tx/${tx.hash}` },
    'rotate-oracle: done',
  );
}

main().catch((err) => {
  logger.error({ err: err.message ?? String(err) }, 'rotate-oracle failed');
  process.exit(1);
});
