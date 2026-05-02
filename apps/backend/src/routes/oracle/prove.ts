import { Hono } from 'hono';
import { isAddress, isHexString } from 'ethers';
import { z } from 'zod';
import { signOracleProof, type OracleKey } from '../../crypto.js';
import type { BackendConfig } from '../../config.js';

const ProveBody = z.object({
  action: z.enum(['transfer', 'revoke']),
  tokenId: z.string().regex(/^\d+$/, 'tokenId must be a non-negative integer string'),
  from: z.string().refine(isAddress, 'from is not a valid address'),
  to: z.string().refine(isAddress, 'to is not a valid address'),
  newPointer: z.string().refine((v) => isHexString(v, 32), 'newPointer must be 0x + 64 hex'),
  dataHash: z.string().refine((v) => isHexString(v, 32), 'dataHash must be 0x + 64 hex'),
  nonce: z.string().regex(/^\d+$/, 'nonce must be a non-negative integer string'),
});

export function proveRoute(opts: { key: OracleKey; config: BackendConfig }) {
  const app = new Hono();
  app.post('/prove', async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ProveBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400);
    }
    const { action, tokenId, from, to, newPointer, dataHash, nonce } = parsed.data;
    const result = signOracleProof(
      opts.key,
      BigInt(opts.config.deployment.chainId),
      opts.config.deployment.addresses.AgentNFT,
      {
        action,
        tokenId: BigInt(tokenId),
        from,
        to,
        newPointer,
        dataHash,
        nonce: BigInt(nonce),
      },
    );
    return c.json({ proof: result.proof });
  });
  return app;
}
