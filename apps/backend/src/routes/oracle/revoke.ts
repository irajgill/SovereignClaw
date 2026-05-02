import { Hono } from 'hono';
import { Contract, JsonRpcProvider, isAddress, isHexString, verifyMessage } from 'ethers';
import { z } from 'zod';
import { AgentNFTAbi } from '@sovereignclaw/inft';
import { signOracleProof, type OracleKey } from '../../crypto.js';
import type { BackendConfig } from '../../config.js';
import type { RevocationStore } from '../../store.js';
import { logger } from '../../logger.js';

const REVOCATION_MESSAGE_PREFIX = 'SovereignClaw revocation v1\nTokenId: ';

const RevokeBody = z.object({
  tokenId: z.string().regex(/^\d+$/),
  owner: z.string().refine(isAddress, 'owner is not a valid address'),
  ownerSig: z.string().refine(isHexString, 'ownerSig must be 0x-hex'),
  oldKeyHash: z.string().refine((v) => isHexString(v, 32), 'oldKeyHash must be 0x + 64 hex'),
});

export interface RevokeRouteOptions {
  key: OracleKey;
  config: BackendConfig;
  store: RevocationStore;
  rpcUrl?: string;
  /**
   * Test seam. When provided, returns the current owner of a token without
   * hitting the chain. Production reads on-chain.
   */
  readOwner?: (tokenId: bigint) => Promise<string>;
  /** Test seam: returns the current `tokenNonce` from chain. */
  readNonce?: (tokenId: bigint) => Promise<bigint>;
}

export function revokeRoute(opts: RevokeRouteOptions) {
  const app = new Hono();
  app.post('/revoke', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = RevokeBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }
    const { tokenId, owner, ownerSig, oldKeyHash } = parsed.data;
    const tokenIdBig = BigInt(tokenId);

    // Verify the EIP-191 owner signature is over the canonical revocation message.
    const expectedMessage = `${REVOCATION_MESSAGE_PREFIX}${tokenId}`;
    let recovered: string;
    try {
      recovered = verifyMessage(expectedMessage, ownerSig);
    } catch (err) {
      return c.json({ error: 'invalid_owner_signature', detail: (err as Error).message }, 400);
    }
    if (recovered.toLowerCase() !== owner.toLowerCase()) {
      return c.json({ error: 'owner_signature_mismatch', recovered }, 401);
    }

    // Confirm `owner` is actually the on-chain owner of the token.
    let onChainOwner: string;
    try {
      onChainOwner = opts.readOwner
        ? await opts.readOwner(tokenIdBig)
        : await defaultReadOwner(
            tokenIdBig,
            opts.config.deployment.addresses.AgentNFT,
            opts.rpcUrl,
          );
    } catch (err) {
      logger.error({ err: (err as Error).message }, 'revoke: chain read failed');
      return c.json({ error: 'chain_read_failed' }, 502);
    }
    if (onChainOwner.toLowerCase() !== owner.toLowerCase()) {
      return c.json({ error: 'not_token_owner', onChainOwner }, 401);
    }

    let nonce: bigint;
    try {
      nonce = opts.readNonce
        ? await opts.readNonce(tokenIdBig)
        : await defaultReadNonce(
            tokenIdBig,
            opts.config.deployment.addresses.AgentNFT,
            opts.rpcUrl,
          );
    } catch {
      nonce = 0n;
    }

    const { proof } = signOracleProof(
      opts.key,
      BigInt(opts.config.deployment.chainId),
      opts.config.deployment.addresses.AgentNFT,
      {
        action: 'revoke',
        tokenId: tokenIdBig,
        from: owner,
        to: owner,
        newPointer: '0x' + '0'.repeat(64),
        dataHash: oldKeyHash,
        nonce,
      },
    );

    // Mark the tokenId revoked in the oracle's own registry. Future
    // /reencrypt calls for this tokenId return 410 even before the on-chain
    // revoke tx confirms.
    opts.store.add(tokenIdBig, owner);
    logger.info({ tokenId, owner }, 'revoke: oracle marked token revoked');

    return c.json({ proof });
  });
  return app;
}

async function defaultReadOwner(
  tokenId: bigint,
  agentNFTAddr: string,
  rpcUrl: string | undefined,
): Promise<string> {
  const provider = new JsonRpcProvider(
    rpcUrl ?? process.env.RPC_URL ?? 'https://evmrpc-testnet.0g.ai',
  );
  const nft = new Contract(agentNFTAddr, AgentNFTAbi as never, provider) as unknown as {
    ownerOf: (tokenId: bigint) => Promise<string>;
  };
  return nft.ownerOf(tokenId);
}

async function defaultReadNonce(
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
