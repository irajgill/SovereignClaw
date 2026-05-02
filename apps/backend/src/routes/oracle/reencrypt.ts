import { Hono } from 'hono';
import { Contract, JsonRpcProvider, hexlify, isAddress, isHexString, keccak256 } from 'ethers';
import { z } from 'zod';
import { AgentNFTAbi } from '@sovereignclaw/inft';
import { signOracleProof, type OracleKey } from '../../crypto.js';
import type { BackendConfig } from '../../config.js';
import type { RevocationStore } from '../../store.js';
import { logger } from '../../logger.js';

/**
 * Phase 3 placeholder re-encryption.
 *
 * Production replaces this with TEE-attested ECIES re-encryption that
 * actually re-wraps the DEK under the new owner's pubkey. Phase 3 keeps the
 * on-chain DEK bytes as-is (re-uses the same bytes for the new owner) so
 * the contract flow can be exercised end-to-end before the wrapping
 * protocol lands. The README and dev-log call this out explicitly.
 *
 * The newPointer is also passed through unchanged from on-chain — the
 * memory blob isn't re-encrypted in Phase 3 either.
 */
const ReencryptBody = z.object({
  tokenId: z.string().regex(/^\d+$/),
  currentOwner: z.string().refine(isAddress, 'currentOwner is not a valid address'),
  newOwner: z.string().refine(isAddress, 'newOwner is not a valid address'),
  newOwnerPubkey: z.string().refine(isHexString, 'newOwnerPubkey must be 0x-hex'),
});

export interface ReencryptRouteOptions {
  key: OracleKey;
  config: BackendConfig;
  store: RevocationStore;
  /** Override RPC URL for reading on-chain state. Defaults to env RPC_URL. */
  rpcUrl?: string;
  /**
   * Test seam. When provided, returns the on-chain Agent record without
   * touching the network. Production always uses the chain.
   */
  readAgent?: (
    tokenId: bigint,
  ) => Promise<{ wrappedDEK: string; encryptedPointer: string; revoked: boolean }>;
}

export function reencryptRoute(opts: ReencryptRouteOptions) {
  const app = new Hono();
  app.post('/reencrypt', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ReencryptBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }
    const { tokenId, currentOwner, newOwner } = parsed.data;
    const tokenIdBig = BigInt(tokenId);

    if (opts.store.has(tokenIdBig)) {
      logger.info({ tokenId }, 'reencrypt: refusing — token revoked in oracle registry');
      return c.json({ error: 'token_revoked', tokenId }, 410);
    }

    let agent: { wrappedDEK: string; encryptedPointer: string; revoked: boolean };
    try {
      agent = opts.readAgent
        ? await opts.readAgent(tokenIdBig)
        : await readAgentFromChain(
            tokenIdBig,
            opts.config.deployment.addresses.AgentNFT,
            opts.rpcUrl,
          );
    } catch (err) {
      logger.error({ err: (err as Error).message, tokenId }, 'reencrypt: chain read failed');
      return c.json({ error: 'chain_read_failed' }, 502);
    }
    if (agent.revoked) {
      // Belt-and-suspenders: chain is the truth. If chain says revoked,
      // mirror it into our store and return 410.
      opts.store.add(tokenIdBig, '0x0000000000000000000000000000000000000000');
      return c.json({ error: 'token_revoked_on_chain', tokenId }, 410);
    }

    // Phase 3 placeholder: pass DEK bytes through. Production: ECIES re-encrypt to newOwner pubkey.
    const newWrappedDEK = agent.wrappedDEK;
    const newPointer = agent.encryptedPointer;
    const dataHash = keccak256(hexlify(newWrappedDEK));

    // Read on-chain nonce so the proof matches the contract's expectation.
    const nonce = await readTokenNonce(
      tokenIdBig,
      opts.config.deployment.addresses.AgentNFT,
      opts.rpcUrl,
    ).catch(() => 0n);

    const { proof } = signOracleProof(
      opts.key,
      BigInt(opts.config.deployment.chainId),
      opts.config.deployment.addresses.AgentNFT,
      {
        action: 'transfer',
        tokenId: tokenIdBig,
        from: currentOwner,
        to: newOwner,
        newPointer,
        dataHash,
        nonce,
      },
    );

    return c.json({ newPointer, newWrappedDEK, proof });
  });
  return app;
}

async function readAgentFromChain(
  tokenId: bigint,
  agentNFTAddr: string,
  rpcUrl: string | undefined,
): Promise<{ wrappedDEK: string; encryptedPointer: string; revoked: boolean }> {
  const provider = new JsonRpcProvider(
    rpcUrl ?? process.env.RPC_URL ?? 'https://evmrpc-testnet.0g.ai',
  );
  const nft = new Contract(agentNFTAddr, AgentNFTAbi as never, provider) as unknown as {
    getAgent: (
      tokenId: bigint,
    ) => Promise<{ wrappedDEK: string; encryptedPointer: string; revoked: boolean }>;
  };
  return nft.getAgent(tokenId);
}

async function readTokenNonce(
  tokenId: bigint,
  agentNFTAddr: string,
  rpcUrl: string | undefined,
): Promise<bigint> {
  const provider = new JsonRpcProvider(
    rpcUrl ?? process.env.RPC_URL ?? 'https://evmrpc-testnet.0g.ai',
  );
  const nft = new Contract(agentNFTAddr, AgentNFTAbi as never, provider) as unknown as {
    tokenNonce: (tokenId: bigint) => Promise<bigint>;
  };
  return nft.tokenNonce(tokenId);
}
