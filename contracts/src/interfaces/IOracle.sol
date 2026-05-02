// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {IAgentNFT} from "./IAgentNFT.sol";

/// @title IOracle
/// @notice Off-chain reference shape for the dev oracle service. Not inherited
///         by any on-chain contract; the chain checks ECDSA signatures against
///         `AgentNFT.oracle()`.
/// @dev The signed payload is the EIP-712 digest of an OracleProof struct
///      minus its `signature` field.
library OracleProofTypeHashes {
    /// @notice EIP-712 typehash for OracleProof minus its `signature` field.
    bytes32 internal constant ORACLE_PROOF_TYPEHASH = keccak256(
        "OracleProof(uint8 action,uint256 tokenId,address from,address to,"
        "bytes32 newPointer,bytes32 dataHash,uint256 nonce)"
    );

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 internal constant DOMAIN_NAME_HASH = keccak256(bytes("SovereignClaw AgentNFT"));
    bytes32 internal constant DOMAIN_VERSION_HASH = keccak256(bytes("1"));
}

/// @notice Reference type for off-chain consumers. Mirrors the oracle-facing
///         contract surface expected by Phase 3 clients.
interface IOracleClient {
    function pubkey() external view returns (address);
}
