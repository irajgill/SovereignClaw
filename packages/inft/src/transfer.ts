/**
 * Transfer an iNFT with oracle re-encryption.
 *
 * Flow per roadmap §9.3:
 *   1. caller (current owner) provides their pubkey-derived target identity.
 *   2. helper calls oracle.reencrypt(tokenId, currentOwner, newOwner, newOwnerPubkey)
 *      → { newPointer, newWrappedDEK, proof }.
 *   3. caller submits AgentNFT.transferWithReencryption(...) with the proof.
 *   4. wait for confirmation, return tx hash + explorer url.
 */
import { type Signer, ZeroAddress, getBytes, hexlify, isAddress, isHexString } from 'ethers';
import { CONTRACT_LIMITS } from './abis.js';
import { explorerTxUrl, getAgentNFT } from './contracts.js';
import type { Deployment } from './deployment.js';
import { ContractRevertError, TransferError } from './errors.js';
import type { OracleClient } from './oracle-client.js';

export interface TransferOptions {
  tokenId: bigint;
  /** Current owner. */
  from: Signer;
  /** New owner address. */
  to: string;
  /** New owner public key (uncompressed, 0x04...) used by the oracle to re-wrap the DEK. */
  newOwnerPubkey: string;
  oracle: OracleClient;
  deployment: Deployment;
  explorerBase?: string;
}

export interface TransferResult {
  txHash: string;
  explorerUrl: string;
  blockNumber: number;
  newPointer: string;
}

export async function transferAgentNFT(opts: TransferOptions): Promise<TransferResult> {
  const { tokenId, from, to, newOwnerPubkey, oracle, deployment } = opts;

  if (!isAddress(to) || to === ZeroAddress) {
    throw new TransferError(`transfer: 'to' must be a valid non-zero address, got ${to}`);
  }
  if (!isHexString(newOwnerPubkey)) {
    throw new TransferError(
      `transfer: newOwnerPubkey must be 0x-hex, got ${newOwnerPubkey.slice(0, 12)}...`,
    );
  }

  const fromAddress = await from.getAddress();
  const reencrypt = await oracle.reencrypt({
    tokenId: tokenId.toString(),
    currentOwner: fromAddress,
    newOwner: to,
    newOwnerPubkey,
  });

  if (!isHexString(reencrypt.newPointer, 32)) {
    throw new TransferError(`transfer: oracle returned invalid newPointer ${reencrypt.newPointer}`);
  }
  if (!isHexString(reencrypt.newWrappedDEK)) {
    throw new TransferError(`transfer: oracle returned invalid newWrappedDEK`);
  }
  if (!isHexString(reencrypt.proof)) {
    throw new TransferError('transfer: oracle returned invalid proof');
  }
  const dekBytes = getBytes(reencrypt.newWrappedDEK);
  if (dekBytes.length > CONTRACT_LIMITS.MAX_WRAPPED_DEK_BYTES) {
    throw new TransferError(
      `transfer: oracle's newWrappedDEK is ${dekBytes.length} bytes; max is ${CONTRACT_LIMITS.MAX_WRAPPED_DEK_BYTES}`,
    );
  }

  const nft = getAgentNFT(deployment.addresses.AgentNFT, from) as unknown as {
    transferWithReencryption: (
      to: string,
      tokenId: bigint,
      newPointer: string,
      newWrappedDEK: string,
      proof: string,
    ) => Promise<{ wait(): Promise<{ hash: string; blockNumber: number } | null> }>;
  };
  let receipt: { hash: string; blockNumber: number } | null;
  try {
    const tx = await nft.transferWithReencryption(
      to,
      tokenId,
      reencrypt.newPointer,
      hexlify(dekBytes),
      reencrypt.proof,
    );
    receipt = await tx.wait();
  } catch (err) {
    throw new ContractRevertError(
      `transfer: contract call reverted: ${(err as Error).message}`,
      undefined,
      undefined,
      { cause: err as Error },
    );
  }
  if (!receipt) throw new TransferError('transfer: tx receipt missing');

  const explorerBase =
    opts.explorerBase ?? deployment.explorer.AgentNFT.replace(/\/address\/.*$/, '');
  return {
    txHash: receipt.hash,
    explorerUrl: explorerTxUrl(explorerBase, receipt.hash),
    blockNumber: receipt.blockNumber,
    newPointer: reencrypt.newPointer,
  };
}
