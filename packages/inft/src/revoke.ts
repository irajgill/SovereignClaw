/**
 * Revoke an iNFT's memory.
 *
 * Flow per roadmap §6.5 + §9.4:
 *   1. owner signs a revocation message with their wallet (EIP-191).
 *   2. helper calls oracle.revoke(tokenId, ownerSig, oldKeyHash) → { proof }.
 *      The oracle marks the tokenId revoked in its own registry; future
 *      `/oracle/reencrypt` calls for this token return HTTP 410.
 *   3. helper submits AgentNFT.revoke(tokenId, oldKeyHash, proof).
 *   4. on success: contract zeroes wrappedDEK, sets revoked=true,
 *      writes to MemoryRevocation. Irreversible.
 */
import { type Signer, isHexString, keccak256 } from 'ethers';
import { explorerTxUrl, getAgentNFT } from './contracts.js';
import type { Deployment } from './deployment.js';
import { ContractRevertError, RevokeError } from './errors.js';
import type { OracleClient } from './oracle-client.js';

export interface RevokeOptions {
  tokenId: bigint;
  /** Current owner. Must equal `AgentNFT.ownerOf(tokenId)`. */
  owner: Signer;
  oracle: OracleClient;
  deployment: Deployment;
  explorerBase?: string;
}

export interface RevokeResult {
  txHash: string;
  explorerUrl: string;
  blockNumber: number;
  oldKeyHash: string;
  revokedAt: number;
}

const REVOCATION_MESSAGE_PREFIX = 'SovereignClaw revocation v1\nTokenId: ';

/**
 * Permanently revoke an iNFT's memory. After this returns, the on-chain
 * wrappedDEK is zeroed, the token is marked revoked, and the oracle refuses
 * future re-encryption for this tokenId. There is no "undo".
 */
export async function revokeMemory(opts: RevokeOptions): Promise<RevokeResult> {
  const { tokenId, owner, oracle, deployment } = opts;

  const nft = getAgentNFT(deployment.addresses.AgentNFT, owner) as unknown as {
    getAgent: (tokenId: bigint) => Promise<{ wrappedDEK: string }>;
    revoke: (
      tokenId: bigint,
      oldKeyHash: string,
      proof: string,
    ) => Promise<{ wait(): Promise<{ hash: string; blockNumber: number } | null> }>;
  };
  // Hash of the current on-chain wrappedDEK; the contract checks this
  // against the proof's dataHash to prove the oracle is signing about the
  // actual DEK being destroyed (not a stale one).
  let currentDek: string;
  try {
    const agent = await nft.getAgent(tokenId);
    currentDek = agent.wrappedDEK;
  } catch (err) {
    throw new RevokeError(`revoke: could not read on-chain wrappedDEK for #${tokenId}`, {
      cause: err as Error,
    });
  }
  if (!isHexString(currentDek)) {
    throw new RevokeError(
      `revoke: on-chain wrappedDEK is not 0x-hex: ${String(currentDek).slice(0, 12)}...`,
    );
  }
  const oldKeyHash = keccak256(currentDek);

  const ownerAddress = await owner.getAddress();
  const ownerSig = await owner.signMessage(`${REVOCATION_MESSAGE_PREFIX}${tokenId}`);

  const { proof } = await oracle.revoke({
    tokenId: tokenId.toString(),
    owner: ownerAddress,
    ownerSig,
    oldKeyHash,
  });
  if (!isHexString(proof)) {
    throw new RevokeError('revoke: oracle returned invalid proof');
  }

  let receipt: { hash: string; blockNumber: number } | null;
  try {
    const tx = await nft.revoke(tokenId, oldKeyHash, proof);
    receipt = await tx.wait();
  } catch (err) {
    throw new ContractRevertError(
      `revoke: contract call reverted: ${(err as Error).message}`,
      undefined,
      undefined,
      { cause: err as Error },
    );
  }
  if (!receipt) throw new RevokeError('revoke: tx receipt missing');

  const explorerBase =
    opts.explorerBase ?? deployment.explorer.AgentNFT.replace(/\/address\/.*$/, '');
  return {
    txHash: receipt.hash,
    explorerUrl: explorerTxUrl(explorerBase, receipt.hash),
    blockNumber: receipt.blockNumber,
    oldKeyHash,
    revokedAt: Math.floor(Date.now() / 1000),
  };
}
