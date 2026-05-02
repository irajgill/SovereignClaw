/**
 * Mint an iNFT for a SovereignClaw agent.
 *
 * Flow per roadmap §9.2:
 *   1. agent.flush() - ensure memory is durable on 0G, get pointer.
 *   2. compute metadataHash = keccak256(canonical(role, pointer, ownerAddr, royaltyBps)).
 *   3. validate inputs against contract limits (fail early, save gas).
 *   4. submit AgentNFT.mint(...).
 *   5. wait for confirmation; parse Minted event for tokenId.
 *   6. return { tokenId, txHash, explorerUrl }.
 *
 * The agent param accepts either a `@sovereignclaw/core` Agent or a
 * minimal duck-typed object `{ role, getPointer(), flush() }`. This keeps
 * @sovereignclaw/inft from depending on @sovereignclaw/core (per Phase 1
 * carryover #5 / §19.5).
 */
import {
  AbiCoder,
  EventLog,
  type Signer,
  ZeroAddress,
  getBytes,
  hexlify,
  isHexString,
  keccak256,
  toUtf8Bytes,
} from 'ethers';
import type { Pointer } from '@sovereignclaw/memory';
import { CONTRACT_LIMITS } from './abis.js';
import { explorerTxUrl, getAgentNFT } from './contracts.js';
import type { Deployment } from './deployment.js';
import { ContractRevertError, MintError } from './errors.js';

export interface MintableAgent {
  readonly role: string;
  /** Returns the latest 0G Storage Log root hash for the agent's manifest. */
  getPointer(): Pointer | Promise<Pointer>;
  /** Forces any pending writes to durable storage. */
  flush?(): Promise<void>;
}

export interface MintOptions {
  agent: MintableAgent;
  /** Wallet that becomes the initial owner of the iNFT. */
  owner: Signer;
  /** Royalty in basis points (0..10000). Default 0. */
  royaltyBps?: number;
  /**
   * DEK wrapped under the owner's pubkey. Phase 3 callers usually pass an
   * empty `Uint8Array` until the wrapping protocol lands; the contract
   * accepts that and Phase 3 transfers re-wrap on the way out. Max 2048 bytes.
   */
  wrappedDEK?: Uint8Array | string;
  /** Pre-loaded deployment record. If omitted, callers should pass `addresses` explicitly. */
  deployment: Deployment;
  /** Override the explorer base URL used in the result. Defaults to deployment.explorer. */
  explorerBase?: string;
}

export interface MintResult {
  tokenId: bigint;
  txHash: string;
  explorerUrl: string;
  blockNumber: number;
  metadataHash: string;
  encryptedPointer: string;
}

export async function mintAgentNFT(opts: MintOptions): Promise<MintResult> {
  const { agent, owner, deployment } = opts;
  const royaltyBps = opts.royaltyBps ?? 0;

  if ((await owner.getAddress()) === ZeroAddress) {
    throw new MintError('mint: owner must be a non-zero address');
  }

  const roleBytes = toUtf8Bytes(agent.role);
  if (roleBytes.length > CONTRACT_LIMITS.MAX_ROLE_BYTES) {
    throw new MintError(
      `mint: role is ${roleBytes.length} bytes; max is ${CONTRACT_LIMITS.MAX_ROLE_BYTES}`,
    );
  }
  if (royaltyBps < 0 || royaltyBps > CONTRACT_LIMITS.MAX_ROYALTY_BPS) {
    throw new MintError(
      `mint: royaltyBps=${royaltyBps} out of range [0, ${CONTRACT_LIMITS.MAX_ROYALTY_BPS}]`,
    );
  }
  const wrappedDEK = normalizeWrappedDEK(opts.wrappedDEK);
  if (wrappedDEK.length > CONTRACT_LIMITS.MAX_WRAPPED_DEK_BYTES) {
    throw new MintError(
      `mint: wrappedDEK is ${wrappedDEK.length} bytes; max is ${CONTRACT_LIMITS.MAX_WRAPPED_DEK_BYTES}`,
    );
  }

  if (agent.flush) await agent.flush();
  const pointer = normalizePointer(await agent.getPointer());

  const ownerAddr = await owner.getAddress();
  const metadataHash = computeMetadataHash({
    role: agent.role,
    pointer,
    owner: ownerAddr,
    royaltyBps,
  });

  const nft = getAgentNFT(deployment.addresses.AgentNFT, owner) as unknown as {
    mint: (
      to: string,
      role: string,
      metadataHash: string,
      encryptedPointer: string,
      wrappedDEK: string,
      royaltyBps: number,
    ) => Promise<{ wait(): Promise<MintReceiptLike | null> }>;
  };
  let receipt: MintReceiptLike | null;
  try {
    const tx = await nft.mint(
      ownerAddr,
      agent.role,
      metadataHash,
      pointer,
      hexlify(wrappedDEK),
      royaltyBps,
    );
    receipt = await tx.wait();
  } catch (err) {
    throw new ContractRevertError(
      `mint: contract call reverted: ${(err as Error).message}`,
      undefined,
      undefined,
      {
        cause: err as Error,
      },
    );
  }

  if (!receipt) {
    throw new MintError('mint: tx receipt missing (rpc returned null)');
  }

  const tokenId = parseTokenIdFromMintedEvent(receipt, ownerAddr);
  const explorerBase =
    opts.explorerBase ?? deployment.explorer.AgentNFT.replace(/\/address\/.*$/, '');
  return {
    tokenId,
    txHash: receipt.hash,
    explorerUrl: explorerTxUrl(explorerBase, receipt.hash),
    blockNumber: receipt.blockNumber,
    metadataHash,
    encryptedPointer: pointer,
  };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

interface MetadataHashInputs {
  role: string;
  pointer: string;
  owner: string;
  royaltyBps: number;
}

/** Canonical encoding for metadataHash so off-chain indexers can recompute. */
export function computeMetadataHash(inputs: MetadataHashInputs): string {
  const abi = AbiCoder.defaultAbiCoder();
  return keccak256(
    abi.encode(
      ['string', 'string', 'bytes32', 'address', 'uint16'],
      [
        'sovereignclaw.agent.metadata.v1',
        inputs.role,
        inputs.pointer,
        inputs.owner,
        inputs.royaltyBps,
      ],
    ),
  );
}

function normalizeWrappedDEK(input: Uint8Array | string | undefined): Uint8Array {
  if (input === undefined) return new Uint8Array();
  if (typeof input === 'string') {
    if (!isHexString(input))
      throw new MintError(`mint: wrappedDEK string must be 0x-hex, got ${input.slice(0, 8)}...`);
    return getBytes(input);
  }
  return input;
}

function normalizePointer(p: Pointer): string {
  if (!isHexString(p, 32)) {
    throw new MintError(`mint: agent.getPointer() did not return a 0x + 64-hex bytes32: ${p}`);
  }
  return p;
}

interface MintReceiptLike {
  hash: string;
  blockNumber: number;
  logs: ReadonlyArray<unknown>;
}

function parseTokenIdFromMintedEvent(receipt: MintReceiptLike, ownerAddr: string): bigint {
  for (const log of receipt.logs) {
    if (!isEventLog(log)) continue;
    if (log.eventName === 'Minted') {
      const tokenId = log.args.getValue('tokenId') as bigint;
      const owner = log.args.getValue('owner') as string;
      if (owner.toLowerCase() === ownerAddr.toLowerCase()) return tokenId;
    }
  }
  throw new MintError('mint: receipt did not contain a Minted event for the expected owner');
}

function isEventLog(log: unknown): log is EventLog {
  return typeof log === 'object' && log !== null && 'eventName' in log && 'args' in log;
}
