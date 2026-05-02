/**
 * Phase 3 §13 DoD integration test: mint -> transfer -> revoke against real
 * 0G Galileo testnet. Requires:
 *   - INTEGRATION=1
 *   - PRIVATE_KEY (alice)
 *   - BOB_PRIVATE_KEY (bob)
 *   - ORACLE_URL (default http://localhost:8787) — apps/backend running and bound
 *
 * Skips with a clear message if any of those is unavailable.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Contract, JsonRpcProvider, Wallet, randomBytes } from 'ethers';
import {
  loadDeployment,
  mintAgentNFT,
  transferAgentNFT,
  revokeMemory,
  OracleClient,
  OracleRevokedError,
  AgentNFTAbi,
  MemoryRevocationAbi,
} from '../../src/index.js';

const RUN = process.env.INTEGRATION === '1';
const HAVE_KEYS = !!(process.env.PRIVATE_KEY && process.env.BOB_PRIVATE_KEY);
const ORACLE_URL = process.env.ORACLE_URL ?? 'http://localhost:8787';

async function oracleReachable(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${ORACLE_URL}/healthz`, { signal: ctrl.signal });
    clearTimeout(t);
    return res.ok;
  } catch {
    return false;
  }
}

const skip = !RUN || !HAVE_KEYS;

describe.skipIf(skip)('inft integration: full lifecycle on 0G testnet', () => {
  let provider: JsonRpcProvider;
  let alice: Wallet;
  let bob: Wallet;
  let oracle: OracleClient;
  let deployment: ReturnType<typeof loadDeployment>;
  let oracleUp = false;

  beforeAll(async () => {
    deployment = loadDeployment();
    provider = new JsonRpcProvider(process.env.RPC_URL ?? 'https://evmrpc-testnet.0g.ai');
    alice = new Wallet(process.env.PRIVATE_KEY!, provider);
    bob = new Wallet(process.env.BOB_PRIVATE_KEY!, provider);
    oracle = new OracleClient({ url: ORACLE_URL });
    oracleUp = await oracleReachable();
  });

  it('oracle is reachable and bound to the deployed AgentNFT', async () => {
    if (!oracleUp) {
      console.warn('SKIP: oracle not reachable at', ORACLE_URL, '(start apps/backend first)');
      return;
    }
    const h = await oracle.healthz();
    expect(h.ok).toBe(true);
    expect(h.agentNFT?.toLowerCase()).toBe(deployment.addresses.AgentNFT.toLowerCase());
  });

  it('mint -> transfer -> revoke succeeds and on-chain state matches expectations', async () => {
    if (!oracleUp) return; // soft skip — earlier test logged

    const pointer = '0x' + 'ab'.repeat(32); // any bytes32; test uses a well-known sentinel
    const minted = await mintAgentNFT({
      agent: { role: 'integration', getPointer: () => pointer },
      owner: alice,
      royaltyBps: 0,
      wrappedDEK: randomBytes(16),
      deployment,
    });
    expect(minted.tokenId).toBeGreaterThan(0n);

    const transferred = await transferAgentNFT({
      tokenId: minted.tokenId,
      from: alice,
      to: bob.address,
      newOwnerPubkey: bob.signingKey.publicKey,
      oracle,
      deployment,
    });
    expect(transferred.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const nft = new Contract(
      deployment.addresses.AgentNFT,
      AgentNFTAbi as never,
      provider,
    ) as unknown as {
      ownerOf: (id: bigint) => Promise<string>;
      tokenNonce: (id: bigint) => Promise<bigint>;
    };
    expect((await nft.ownerOf(minted.tokenId)).toLowerCase()).toBe(bob.address.toLowerCase());
    expect(await nft.tokenNonce(minted.tokenId)).toBe(1n);

    const revoked = await revokeMemory({
      tokenId: minted.tokenId,
      owner: bob,
      oracle,
      deployment,
    });
    expect(revoked.txHash).toMatch(/^0x[0-9a-f]{64}$/);

    const reg = new Contract(
      deployment.addresses.MemoryRevocation,
      MemoryRevocationAbi as never,
      provider,
    ) as unknown as {
      isRevoked: (id: bigint) => Promise<boolean>;
    };
    expect(await reg.isRevoked(minted.tokenId)).toBe(true);

    const agent = await (
      new Contract(deployment.addresses.AgentNFT, AgentNFTAbi as never, provider) as unknown as {
        getAgent: (id: bigint) => Promise<{ revoked: boolean; wrappedDEK: string }>;
      }
    ).getAgent(minted.tokenId);
    expect(agent.revoked).toBe(true);
    expect(agent.wrappedDEK).toBe('0x');

    await expect(
      oracle.reencrypt({
        tokenId: minted.tokenId.toString(),
        currentOwner: bob.address,
        newOwner: alice.address,
        newOwnerPubkey: alice.signingKey.publicKey,
      }),
    ).rejects.toBeInstanceOf(OracleRevokedError);
  }, 240_000);
});
