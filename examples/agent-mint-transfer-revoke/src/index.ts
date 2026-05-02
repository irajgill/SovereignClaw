/**
 * Phase 3 Definition-of-Done example.
 *
 * Mint -> transfer (with oracle re-encryption) -> revoke against real
 * 0G Galileo testnet. Each step prints its tx hash and chainscan URL.
 *
 * Prereqs (see README.md):
 *   1. apps/backend running locally on $ORACLE_URL (default :8787)
 *   2. Alice (PRIVATE_KEY) and Bob (BOB_PRIVATE_KEY) wallets funded on testnet
 *   3. deployments/0g-testnet.json present and oracle rotated to apps/backend's key
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

{
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '.env'),
    resolve(here, '..', '..', '..', '.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path });
      break;
    }
  }
}

import { Wallet, JsonRpcProvider, hexlify, randomBytes, getAddress } from 'ethers';
import {
  loadDeployment,
  mintAgentNFT,
  transferAgentNFT,
  revokeMemory,
  OracleClient,
  OracleRevokedError,
} from '@sovereignclaw/inft';
import { encrypted, OG_Log, deriveKekFromSigner } from '@sovereignclaw/memory';

interface ExampleEnv {
  RPC_URL: string;
  EXPLORER_URL: string;
  INDEXER_URL: string;
  PRIVATE_KEY: string;
  BOB_PRIVATE_KEY: string;
  ORACLE_URL: string;
  ORACLE_AUTH_TOKEN?: string;
  KEK_NAMESPACE: string;
}

function loadExampleEnv(): ExampleEnv {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing required env var: ${k}`);
    return v;
  };
  return {
    RPC_URL: need('RPC_URL'),
    EXPLORER_URL: need('EXPLORER_URL'),
    INDEXER_URL: need('INDEXER_URL'),
    PRIVATE_KEY: need('PRIVATE_KEY'),
    BOB_PRIVATE_KEY: need('BOB_PRIVATE_KEY'),
    ORACLE_URL: process.env.ORACLE_URL ?? 'http://localhost:8787',
    ORACLE_AUTH_TOKEN: process.env.ORACLE_AUTH_TOKEN || undefined,
    KEK_NAMESPACE: process.env.KEK_NAMESPACE ?? 'example-agent-mint-transfer-revoke',
  };
}

function log(step: string, data: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ step, ...data }, null, 2));
}

async function main(): Promise<void> {
  const env = loadExampleEnv();
  const provider = new JsonRpcProvider(env.RPC_URL);
  const alice = new Wallet(env.PRIVATE_KEY, provider);
  const bob = new Wallet(env.BOB_PRIVATE_KEY, provider);

  const deployment = loadDeployment();
  const oracle = new OracleClient({ url: env.ORACLE_URL, authToken: env.ORACLE_AUTH_TOKEN });

  log('start', {
    alice: alice.address,
    bob: bob.address,
    chainId: deployment.chainId,
    AgentNFT: deployment.addresses.AgentNFT,
    oracleUrl: env.ORACLE_URL,
  });

  // 0. Sanity: oracle is up and bound to the same chain + AgentNFT.
  const oracleHealth = await oracle.healthz();
  log('oracle.healthz', oracleHealth as Record<string, unknown>);
  const onChainOracle = await readOracle(deployment.addresses.AgentNFT, provider);
  if (onChainOracle.toLowerCase() !== oracleHealth.oracleAddress.toLowerCase()) {
    throw new Error(
      `oracle mismatch: AgentNFT.oracle=${onChainOracle}, backend says ${oracleHealth.oracleAddress}. Run 'pnpm rotate:oracle'.`,
    );
  }

  // 1. Build encrypted memory and write a couple of entries.
  const kek = await deriveKekFromSigner(alice, env.KEK_NAMESPACE);
  const memory = encrypted(
    OG_Log({
      namespace: env.KEK_NAMESPACE,
      rpcUrl: env.RPC_URL,
      indexerUrl: env.INDEXER_URL,
      signer: alice,
    }),
    { kek },
  );
  const valueBytes = new TextEncoder().encode(
    JSON.stringify({ greeting: 'hello from alice', writtenAt: Date.now() }),
  );
  const setResult = await memory.set('greeting', valueBytes);
  await memory.flush();
  log('memory.set', { pointer: setResult.pointer });

  const agent: { role: string; getPointer: () => string } = {
    role: 'researcher',
    getPointer: () => setResult.pointer,
  };

  // 2. Alice mints. Phase 3 ships an empty wrappedDEK (the contract accepts it
  //    and the oracle's transfer flow re-uses the on-chain bytes).
  const wrappedDEK = randomBytes(32); // placeholder material, length-bounded
  const minted = await mintAgentNFT({
    agent,
    owner: alice,
    royaltyBps: 500,
    wrappedDEK,
    deployment,
    explorerBase: env.EXPLORER_URL,
  });
  log('mint', {
    tokenId: minted.tokenId.toString(),
    txHash: minted.txHash,
    explorerUrl: minted.explorerUrl,
    metadataHash: minted.metadataHash,
  });

  // 3. Alice transfers to Bob via the oracle re-encryption gate.
  const transferred = await transferAgentNFT({
    tokenId: minted.tokenId,
    from: alice,
    to: bob.address,
    newOwnerPubkey: bob.signingKey.publicKey,
    oracle,
    deployment,
    explorerBase: env.EXPLORER_URL,
  });
  log('transfer', {
    tokenId: minted.tokenId.toString(),
    newOwner: bob.address,
    txHash: transferred.txHash,
    explorerUrl: transferred.explorerUrl,
  });

  // 4. Bob revokes.
  const revoked = await revokeMemory({
    tokenId: minted.tokenId,
    owner: bob,
    oracle,
    deployment,
    explorerBase: env.EXPLORER_URL,
  });
  log('revoke', {
    tokenId: minted.tokenId.toString(),
    txHash: revoked.txHash,
    explorerUrl: revoked.explorerUrl,
    oldKeyHash: revoked.oldKeyHash,
  });

  // 5. Asserts: registry says revoked, on-chain agent reports revoked + zero DEK,
  //    oracle now refuses /reencrypt for this tokenId.
  await assertRevokedOnChain(deployment, minted.tokenId, provider);
  try {
    await oracle.reencrypt({
      tokenId: minted.tokenId.toString(),
      currentOwner: bob.address,
      newOwner: alice.address,
      newOwnerPubkey: alice.signingKey.publicKey,
    });
    throw new Error('post-revoke: oracle accepted reencrypt — expected 410');
  } catch (err) {
    if (!(err instanceof OracleRevokedError)) throw err;
    log('post-revoke', { oracleRefusedWith: 'OracleRevokedError', expected: true });
  }

  log('done', {
    summary: 'mint -> transfer -> revoke flow completed end-to-end',
    explorer: {
      mint: minted.explorerUrl,
      transfer: transferred.explorerUrl,
      revoke: revoked.explorerUrl,
    },
  });
}

async function readOracle(agentNFTAddr: string, provider: JsonRpcProvider): Promise<string> {
  const { Contract } = await import('ethers');
  const { AgentNFTAbi } = await import('@sovereignclaw/inft');
  const c = new Contract(agentNFTAddr, AgentNFTAbi as never, provider) as unknown as {
    oracle: () => Promise<string>;
  };
  return c.oracle();
}

async function assertRevokedOnChain(
  deployment: ReturnType<typeof loadDeployment>,
  tokenId: bigint,
  provider: JsonRpcProvider,
): Promise<void> {
  const { Contract } = await import('ethers');
  const { AgentNFTAbi, MemoryRevocationAbi } = await import('@sovereignclaw/inft');
  const nft = new Contract(
    deployment.addresses.AgentNFT,
    AgentNFTAbi as never,
    provider,
  ) as unknown as {
    getAgent: (tokenId: bigint) => Promise<{ revoked: boolean; wrappedDEK: string }>;
  };
  const reg = new Contract(
    deployment.addresses.MemoryRevocation,
    MemoryRevocationAbi as never,
    provider,
  ) as unknown as {
    isRevoked: (tokenId: bigint) => Promise<boolean>;
  };
  const agent = await nft.getAgent(tokenId);
  if (!agent.revoked) throw new Error('post-revoke: agent.revoked is false on-chain');
  if (agent.wrappedDEK !== '0x')
    throw new Error(`post-revoke: wrappedDEK is not empty: ${agent.wrappedDEK}`);
  // The dynamic-bytes slot is freed; assert by hex length (2 = "0x" only).
  if (agent.wrappedDEK.length !== 2)
    throw new Error(`post-revoke: wrappedDEK length unexpected: ${agent.wrappedDEK.length}`);
  const r = await reg.isRevoked(tokenId);
  if (!r) throw new Error('post-revoke: MemoryRevocation.isRevoked says false');
  log('post-revoke.assert', {
    'AgentNFT.revoked': agent.revoked,
    'AgentNFT.wrappedDEK.length': agent.wrappedDEK.length,
    'MemoryRevocation.isRevoked': r,
    addressUsed: getAddress(deployment.addresses.MemoryRevocation),
  });
  // Touch hexlify so unused-import lint stays clean if we ever pull on it.
  void hexlify(new Uint8Array());
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ error: (err as Error).message ?? String(err) }, null, 2));
  process.exit(1);
});
