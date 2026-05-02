/**
 * EIP-712 typehash mirror for AgentNFT.
 *
 * Constants come from `deployments/eip712-typehashes.json`, which is
 * regenerated every test run by `contracts/test/EmitTypeHashes.t.sol` from
 * the Solidity library `OracleProofTypeHashes`. The TS implementation in
 * `digestForOracleProof` recomputes the typehashes locally from the canonical
 * type strings and asserts byte-equality against the fixture; if anyone
 * changes the Solidity literal without updating the TS literal (or vice
 * versa), the unit test in `test/eip712-roundtrip.test.ts` fails.
 *
 * On-chain reference: contracts/src/AgentNFT.sol::_verifyOracleProof.
 * Off-chain reference: contracts/test/helpers/OracleSigner.sol::digest().
 */
import { AbiCoder, keccak256, toUtf8Bytes, getBytes, concat } from 'ethers';

import fixture from '../../../deployments/eip712-typehashes.json' with { type: 'json' };

export const ORACLE_PROOF_TYPE_LITERAL =
  'OracleProof(uint8 action,uint256 tokenId,address from,address to,bytes32 newPointer,bytes32 dataHash,uint256 nonce)';
export const DOMAIN_TYPE_LITERAL =
  'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
export const DOMAIN_NAME_LITERAL = 'SovereignClaw AgentNFT';
export const DOMAIN_VERSION_LITERAL = '1';

/** Hashes computed locally from the canonical strings above. */
export const ORACLE_PROOF_TYPEHASH: string = keccak256(toUtf8Bytes(ORACLE_PROOF_TYPE_LITERAL));
export const DOMAIN_TYPEHASH: string = keccak256(toUtf8Bytes(DOMAIN_TYPE_LITERAL));
export const DOMAIN_NAME_HASH: string = keccak256(toUtf8Bytes(DOMAIN_NAME_LITERAL));
export const DOMAIN_VERSION_HASH: string = keccak256(toUtf8Bytes(DOMAIN_VERSION_LITERAL));

/** Snapshot of the four hashes the contract uses, captured by Foundry. */
export const FIXTURE = fixture as {
  ORACLE_PROOF_TYPEHASH: string;
  DOMAIN_TYPEHASH: string;
  DOMAIN_NAME_HASH: string;
  DOMAIN_VERSION_HASH: string;
  DOMAIN_NAME_LITERAL: string;
  DOMAIN_VERSION_LITERAL: string;
  ORACLE_PROOF_TYPE_LITERAL: string;
};

export type OracleAction = 'transfer' | 'revoke';

export const ORACLE_ACTION_TRANSFER = 0;
export const ORACLE_ACTION_REVOKE = 1;

export function actionToUint8(a: OracleAction): number {
  return a === 'transfer' ? ORACLE_ACTION_TRANSFER : ORACLE_ACTION_REVOKE;
}

export interface OracleProofFields {
  action: OracleAction;
  tokenId: bigint;
  from: string;
  to: string;
  newPointer: string;
  dataHash: string;
  nonce: bigint;
}

const abi = AbiCoder.defaultAbiCoder();

export function computeDomainSeparator(chainId: bigint, verifyingContract: string): string {
  return keccak256(
    abi.encode(
      ['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
      [DOMAIN_TYPEHASH, DOMAIN_NAME_HASH, DOMAIN_VERSION_HASH, chainId, verifyingContract],
    ),
  );
}

export function computeOracleProofStructHash(p: OracleProofFields): string {
  return keccak256(
    abi.encode(
      ['bytes32', 'uint8', 'uint256', 'address', 'address', 'bytes32', 'bytes32', 'uint256'],
      [
        ORACLE_PROOF_TYPEHASH,
        actionToUint8(p.action),
        p.tokenId,
        p.from,
        p.to,
        p.newPointer,
        p.dataHash,
        p.nonce,
      ],
    ),
  );
}

/**
 * The EIP-712 digest the oracle key signs. Byte-identical to
 * `keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash))`
 * inside `AgentNFT._verifyOracleProof`.
 */
export function digestForOracleProof(
  chainId: bigint,
  verifyingContract: string,
  p: OracleProofFields,
): string {
  const ds = computeDomainSeparator(chainId, verifyingContract);
  const sh = computeOracleProofStructHash(p);
  return keccak256(concat([getBytes('0x1901'), getBytes(ds), getBytes(sh)]));
}

/**
 * ABI-encode the OracleProof struct exactly as `transferWithReencryption` /
 * `revoke` expect it on the wire (i.e. `bytes calldata oracleProof`). The
 * `signature` field is the 65-byte ECDSA signature over the digest above.
 */
export function encodeOracleProof(p: OracleProofFields, signature: string): string {
  return abi.encode(
    [
      'tuple(uint8 action,uint256 tokenId,address from,address to,bytes32 newPointer,bytes32 dataHash,uint256 nonce,bytes signature)',
    ],
    [
      [
        actionToUint8(p.action),
        p.tokenId,
        p.from,
        p.to,
        p.newPointer,
        p.dataHash,
        p.nonce,
        signature,
      ],
    ],
  );
}

/**
 * Assert that the locally-derived typehashes match the Foundry-emitted fixture.
 * Calling at module load is intentionally avoided; callers (unit test, server
 * boot) opt in so a stale fixture during dev is debuggable.
 */
export function assertTypeHashesMatchFixture(): void {
  const mismatches: string[] = [];
  if (ORACLE_PROOF_TYPEHASH !== FIXTURE.ORACLE_PROOF_TYPEHASH)
    mismatches.push(
      `ORACLE_PROOF_TYPEHASH: ts=${ORACLE_PROOF_TYPEHASH} fixture=${FIXTURE.ORACLE_PROOF_TYPEHASH}`,
    );
  if (DOMAIN_TYPEHASH !== FIXTURE.DOMAIN_TYPEHASH)
    mismatches.push(`DOMAIN_TYPEHASH: ts=${DOMAIN_TYPEHASH} fixture=${FIXTURE.DOMAIN_TYPEHASH}`);
  if (DOMAIN_NAME_HASH !== FIXTURE.DOMAIN_NAME_HASH)
    mismatches.push(`DOMAIN_NAME_HASH: ts=${DOMAIN_NAME_HASH} fixture=${FIXTURE.DOMAIN_NAME_HASH}`);
  if (DOMAIN_VERSION_HASH !== FIXTURE.DOMAIN_VERSION_HASH)
    mismatches.push(
      `DOMAIN_VERSION_HASH: ts=${DOMAIN_VERSION_HASH} fixture=${FIXTURE.DOMAIN_VERSION_HASH}`,
    );
  if (mismatches.length > 0) {
    throw new Error(`EIP-712 typehash drift detected:\n  ${mismatches.join('\n  ')}`);
  }
}
