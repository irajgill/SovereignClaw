/**
 * Emit a UsageRecorded event for off-chain royalty splitters.
 * Does not transfer funds; downstream is responsible for accounting.
 */
import { type Signer } from 'ethers';
import { explorerTxUrl, getAgentNFT } from './contracts.js';
import type { Deployment } from './deployment.js';
import { ContractRevertError, RecordUsageError } from './errors.js';

export interface RecordUsageOptions {
  tokenId: bigint;
  payer: string;
  amount: bigint;
  /** Owner or a usage-authorized address. Anyone else reverts on-chain. */
  signer: Signer;
  deployment: Deployment;
  explorerBase?: string;
}

export interface RecordUsageResult {
  txHash: string;
  explorerUrl: string;
  blockNumber: number;
}

export async function recordUsage(opts: RecordUsageOptions): Promise<RecordUsageResult> {
  const { tokenId, payer, amount, signer, deployment } = opts;

  if (amount < 0n) {
    throw new RecordUsageError(`recordUsage: amount cannot be negative, got ${amount}`);
  }

  const nft = getAgentNFT(deployment.addresses.AgentNFT, signer) as unknown as {
    recordUsage: (
      tokenId: bigint,
      payer: string,
      amount: bigint,
    ) => Promise<{ wait(): Promise<{ hash: string; blockNumber: number } | null> }>;
  };
  let receipt: { hash: string; blockNumber: number } | null;
  try {
    const tx = await nft.recordUsage(tokenId, payer, amount);
    receipt = await tx.wait();
  } catch (err) {
    throw new ContractRevertError(
      `recordUsage: contract call reverted: ${(err as Error).message}`,
      undefined,
      undefined,
      { cause: err as Error },
    );
  }
  if (!receipt) throw new RecordUsageError('recordUsage: tx receipt missing');

  const explorerBase =
    opts.explorerBase ?? deployment.explorer.AgentNFT.replace(/\/address\/.*$/, '');
  return {
    txHash: receipt.hash,
    explorerUrl: explorerTxUrl(explorerBase, receipt.hash),
    blockNumber: receipt.blockNumber,
  };
}
