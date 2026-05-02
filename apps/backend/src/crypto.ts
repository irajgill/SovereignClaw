/**
 * Oracle keypair management and EIP-712 proof signing.
 *
 * Single keypair, loaded from `ORACLE_PRIVATE_KEY`. Signs EIP-712 typed-data
 * digests over the OracleProof struct in a way byte-identical to what
 * `AgentNFT._verifyOracleProof` reconstructs.
 */
import { Signature, SigningKey, computeAddress, getBytes } from 'ethers';
import {
  digestForOracleProof,
  encodeOracleProof,
  type OracleAction,
  type OracleProofFields,
} from './eip712.js';

export interface OracleKey {
  /** secp256k1 signing key. Private — never logged. */
  readonly signingKey: SigningKey;
  /** Public Ethereum address (cached). */
  readonly address: string;
}

export function loadOracleKey(privateKeyHex: string): OracleKey {
  const signingKey = new SigningKey(privateKeyHex);
  return { signingKey, address: computeAddress(signingKey.publicKey) };
}

export interface ProofRequest {
  action: OracleAction;
  tokenId: bigint;
  from: string;
  to: string;
  newPointer: string;
  dataHash: string;
  nonce: bigint;
}

export interface ProofResult {
  /** ABI-encoded `OracleProof` ready to pass to the contract as `bytes`. */
  proof: string;
  /** Raw 65-byte signature (0x-hex). */
  signature: string;
  /** EIP-712 digest the key signed. */
  digest: string;
}

/** Sign an OracleProof against the bound AgentNFT on the bound chainId. */
export function signOracleProof(
  key: OracleKey,
  chainId: bigint,
  verifyingContract: string,
  req: ProofRequest,
): ProofResult {
  const fields: OracleProofFields = {
    action: req.action,
    tokenId: req.tokenId,
    from: req.from,
    to: req.to,
    newPointer: req.newPointer,
    dataHash: req.dataHash,
    nonce: req.nonce,
  };
  const digest = digestForOracleProof(chainId, verifyingContract, fields);
  const sig = key.signingKey.sign(getBytes(digest));
  const signature = Signature.from(sig).serialized;
  const proof = encodeOracleProof(fields, signature);
  return { proof, signature, digest };
}
