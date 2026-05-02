/**
 * @sovereignclaw/inft
 *
 * ERC-7857 iNFT lifecycle helpers for SovereignClaw. Wraps the deployed
 * `AgentNFT` and `MemoryRevocation` contracts on 0G Galileo testnet.
 */
export const VERSION = '0.0.0';

export { mintAgentNFT, computeMetadataHash } from './mint.js';
export type { MintOptions, MintResult, MintableAgent } from './mint.js';

export { transferAgentNFT } from './transfer.js';
export type { TransferOptions, TransferResult } from './transfer.js';

export { revokeMemory } from './revoke.js';
export type { RevokeOptions, RevokeResult } from './revoke.js';

export { recordUsage } from './usage.js';
export type { RecordUsageOptions, RecordUsageResult } from './usage.js';

export { OracleClient } from './oracle-client.js';
export type {
  OracleClientOptions,
  OraclePubkey,
  ReencryptRequest,
  ReencryptResponse,
  RevokeRequest,
  RevokeResponse,
  ProveRequest,
  ProveResponse,
} from './oracle-client.js';

export { loadDeployment } from './deployment.js';
export type { Deployment, LoadDeploymentOptions } from './deployment.js';

export { AgentNFTAbi, MemoryRevocationAbi, CONTRACT_LIMITS } from './abis.js';
export { explorerAddressUrl, explorerTxUrl } from './contracts.js';

export {
  digestForOracleProof,
  computeDomainSeparator,
  computeOracleProofStructHash,
  encodeOracleProof,
  assertTypeHashesMatchFixture,
  ORACLE_PROOF_TYPEHASH,
  DOMAIN_TYPEHASH,
  DOMAIN_NAME_HASH,
  DOMAIN_VERSION_HASH,
  ORACLE_PROOF_TYPE_LITERAL,
  DOMAIN_TYPE_LITERAL,
  DOMAIN_NAME_LITERAL,
  DOMAIN_VERSION_LITERAL,
  actionToUint8,
  ORACLE_ACTION_TRANSFER,
  ORACLE_ACTION_REVOKE,
} from './eip712.js';
export type { OracleAction, OracleProofFields } from './eip712.js';

export {
  InftError,
  MintError,
  TransferError,
  RevokeError,
  RecordUsageError,
  OracleClientError,
  OracleAuthError,
  OracleHttpError,
  OracleRevokedError,
  OracleTimeoutError,
  OracleUnreachableError,
  ContractRevertError,
  DeploymentNotFoundError,
} from './errors.js';
