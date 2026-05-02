/**
 * Re-exports EIP-712 helpers from @sovereignclaw/inft so the backend has a
 * single, byte-exact source of typehashes and digest computation.
 *
 * This is intentionally a thin re-export. If you change EIP-712 here without
 * updating the contract or @sovereignclaw/inft, the unit test in
 * `test/unit/crypto.test.ts` will fail.
 */
export {
  ORACLE_PROOF_TYPEHASH,
  DOMAIN_TYPEHASH,
  DOMAIN_NAME_HASH,
  DOMAIN_VERSION_HASH,
  ORACLE_PROOF_TYPE_LITERAL,
  DOMAIN_TYPE_LITERAL,
  DOMAIN_NAME_LITERAL,
  DOMAIN_VERSION_LITERAL,
  digestForOracleProof,
  computeDomainSeparator,
  computeOracleProofStructHash,
  encodeOracleProof,
  actionToUint8,
  ORACLE_ACTION_TRANSFER,
  ORACLE_ACTION_REVOKE,
  assertTypeHashesMatchFixture,
} from '@sovereignclaw/inft';
export type { OracleAction, OracleProofFields } from '@sovereignclaw/inft';
