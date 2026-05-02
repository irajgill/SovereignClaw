/**
 * Phase 2 deployment sanity check. Reads deployments/0g-testnet.json,
 * connects to 0G Galileo testnet, and asserts:
 *   - Both contracts have non-empty bytecode at their addresses.
 *   - MemoryRevocation.agentNFT() == AgentNFT.address
 *   - AgentNFT.revocationRegistry() == MemoryRevocation.address
 *   - AgentNFT.oracle() == record.oracle
 *   - AgentNFT.owner() == record.deployer
 *   - MemoryRevocation.DESTROYED_SENTINEL() == keccak256("SOVEREIGNCLAW:DESTROYED:v1")
 *
 * Use this any time after deploy to prove the on-chain contracts match
 * the committed deployment record.
 *
 *   pnpm check:deployment
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const DESTROYED_SENTINEL = ethers.keccak256(ethers.toUtf8Bytes('SOVEREIGNCLAW:DESTROYED:v1'));

const REGISTRY_ABI = [
  'function agentNFT() view returns (address)',
  'function DESTROYED_SENTINEL() view returns (bytes32)',
];
const NFT_ABI = [
  'function revocationRegistry() view returns (address)',
  'function oracle() view returns (address)',
  'function owner() view returns (address)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
];

interface DeploymentRecord {
  network: string;
  chainId: number;
  deployer: string;
  oracle: string;
  addresses: { MemoryRevocation: string; AgentNFT: string };
}

async function main(): Promise<void> {
  const env = loadEnv();
  const record = JSON.parse(
    readFileSync(resolve(REPO_ROOT, 'deployments', '0g-testnet.json'), 'utf8'),
  ) as DeploymentRecord;
  if (record.chainId !== env.CHAIN_ID) {
    throw new Error(`chainId mismatch: record=${record.chainId} env=${env.CHAIN_ID}`);
  }

  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];

  for (const [name, addr] of Object.entries(record.addresses)) {
    const code = await provider.getCode(addr);
    checks.push({
      name: `${name} bytecode present`,
      ok: code !== '0x' && code.length > 2,
      detail: `${code.length} bytes`,
    });
  }

  const registry = new ethers.Contract(
    record.addresses.MemoryRevocation,
    REGISTRY_ABI,
    provider,
  ) as unknown as {
    agentNFT: () => Promise<string>;
    DESTROYED_SENTINEL: () => Promise<string>;
  };
  const nft = new ethers.Contract(record.addresses.AgentNFT, NFT_ABI, provider) as unknown as {
    revocationRegistry: () => Promise<string>;
    oracle: () => Promise<string>;
    owner: () => Promise<string>;
    name: () => Promise<string>;
    symbol: () => Promise<string>;
  };

  const registryAgentNFT = (await registry.agentNFT()) as string;
  checks.push({
    name: 'MemoryRevocation.agentNFT == AgentNFT',
    ok: registryAgentNFT.toLowerCase() === record.addresses.AgentNFT.toLowerCase(),
    detail: registryAgentNFT,
  });

  const sentinel = (await registry.DESTROYED_SENTINEL()) as string;
  checks.push({
    name: 'DESTROYED_SENTINEL matches',
    ok: sentinel === DESTROYED_SENTINEL,
    detail: sentinel,
  });

  const nftRegistry = (await nft.revocationRegistry()) as string;
  checks.push({
    name: 'AgentNFT.revocationRegistry == MemoryRevocation',
    ok: nftRegistry.toLowerCase() === record.addresses.MemoryRevocation.toLowerCase(),
    detail: nftRegistry,
  });

  const nftOracle = (await nft.oracle()) as string;
  checks.push({
    name: 'AgentNFT.oracle == record.oracle',
    ok: nftOracle.toLowerCase() === record.oracle.toLowerCase(),
    detail: nftOracle,
  });

  // Optional: if ORACLE_ADDRESS is set in env, assert the live oracle matches
  // it. This catches "I forgot to rotate setOracle" before any mint/transfer.
  const envOracle = process.env.ORACLE_ADDRESS;
  if (envOracle && /^0x[0-9a-fA-F]{40}$/.test(envOracle)) {
    checks.push({
      name: 'AgentNFT.oracle == env.ORACLE_ADDRESS',
      ok: nftOracle.toLowerCase() === envOracle.toLowerCase(),
      detail: `chain=${nftOracle} env=${envOracle}`,
    });
  }

  const nftOwner = (await nft.owner()) as string;
  checks.push({
    name: 'AgentNFT.owner == record.deployer',
    ok: nftOwner.toLowerCase() === record.deployer.toLowerCase(),
    detail: nftOwner,
  });

  const nftName = (await nft.name()) as string;
  const nftSymbol = (await nft.symbol()) as string;
  checks.push({
    name: 'AgentNFT.name == "SovereignClaw Agent"',
    ok: nftName === 'SovereignClaw Agent',
    detail: nftName,
  });
  checks.push({
    name: 'AgentNFT.symbol == "SCAGENT"',
    ok: nftSymbol === 'SCAGENT',
    detail: nftSymbol,
  });

  for (const c of checks) {
    const tag = c.ok ? 'OK ' : 'FAIL';
    logger.info({ check: c.name, detail: c.detail }, `${tag}`);
  }

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    logger.error({ failedCount: failed.length }, 'deployment check failed');
    process.exit(1);
  }
  logger.info({ checked: checks.length }, 'deployment check: all green');
}

main().catch((err) => {
  logger.error({ err }, 'deployment check failed');
  process.exit(1);
});
