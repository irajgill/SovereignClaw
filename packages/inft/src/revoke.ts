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

/**
 * Phases a `revokeMemory` call passes through, in order. The callback
 * fires AT the start of each phase so callers can take wall-clock
 * samples for benchmarking or UI progress.
 *
 * - `started`         — before any work (t0). Use as the baseline.
 * - `signed`          — owner EIP-191 signature completed.
 * - `oracle-refused`  — `oracle.revoke` returned; the oracle's in-memory
 *                       revocation registry has already marked this
 *                       tokenId, so any concurrent `/oracle/reencrypt`
 *                       from this moment onward returns HTTP 410.
 *                       **This is the "oracle-side unreadable" moment.**
 * - `chain-submitted` — `AgentNFT.revoke` tx broadcast; awaiting receipt.
 * - `chain-confirmed` — receipt in; `wrappedDEK` zeroed on-chain.
 *                       **This is the "chain-durable unreadable" moment.**
 */
export type RevokePhase =
  | 'started'
  | 'signed'
  | 'oracle-refused'
  | 'chain-submitted'
  | 'chain-confirmed';

export interface RevokeOptions {
  tokenId: bigint;
  /** Current owner. Must equal `AgentNFT.ownerOf(tokenId)`. */
  owner: Signer;
  oracle: OracleClient;
  deployment: Deployment;
  explorerBase?: string;
  /**
   * Optional phase hook. Called synchronously at the start of each phase
   * with the phase name and the millisecond wall time when the hook
   * fires. Errors thrown here are swallowed so a misbehaving hook cannot
   * break the revoke itself.
   */
  onPhase?: (phase: RevokePhase, atMs: number) => void;
}

export interface RevokeResult {
  txHash: string;
  explorerUrl: string;
  blockNumber: number;
  oldKeyHash: string;
  revokedAt: number;
  /**
   * Wall-clock timings, captured from inside `revokeMemory`. Useful for
   * UI progress bars and benchmarks without having to duplicate the flow
   * externally. All values are milliseconds relative to the same monotonic
   * clock as `Date.now()`; subtract `started` to get phase-relative times.
   */
  timings: Record<RevokePhase, number>;
}

const REVOCATION_MESSAGE_PREFIX = 'SovereignClaw revocation v1\nTokenId: ';

/**
 * Permanently revoke an iNFT's memory. After this returns, the on-chain
 * wrappedDEK is zeroed, the token is marked revoked, and the oracle refuses
 * future re-encryption for this tokenId. There is no "undo".
 */
export async function revokeMemory(opts: RevokeOptions): Promise<RevokeResult> {
  const { tokenId, owner, oracle, deployment, onPhase } = opts;

  const timings = {} as Record<RevokePhase, number>;
  const markPhase = (phase: RevokePhase): void => {
    const at = Date.now();
    timings[phase] = at;
    if (onPhase) {
      try {
        onPhase(phase, at);
      } catch {
        // caller hook errors must not break revoke.
      }
    }
  };
  markPhase('started');

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
  markPhase('signed');

  const { proof } = await oracle.revoke({
    tokenId: tokenId.toString(),
    owner: ownerAddress,
    ownerSig,
    oldKeyHash,
  });
  if (!isHexString(proof)) {
    throw new RevokeError('revoke: oracle returned invalid proof');
  }
  markPhase('oracle-refused');

  let receipt: { hash: string; blockNumber: number } | null;
  try {
    const tx = await nft.revoke(tokenId, oldKeyHash, proof);
    markPhase('chain-submitted');
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
  markPhase('chain-confirmed');

  const explorerBase =
    opts.explorerBase ?? deployment.explorer.AgentNFT.replace(/\/address\/.*$/, '');
  return {
    txHash: receipt.hash,
    explorerUrl: explorerTxUrl(explorerBase, receipt.hash),
    blockNumber: receipt.blockNumber,
    oldKeyHash,
    revokedAt: Math.floor(Date.now() / 1000),
    timings,
  };
}
