// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {IAgentNFT} from "../../src/interfaces/IAgentNFT.sol";
import {OracleProofTypeHashes} from "../../src/interfaces/IOracle.sol";

/// @title OracleSigner
/// @notice Foundry helper: builds and signs valid `IAgentNFT.OracleProof`
///         payloads using `vm.sign(pk, digest)`. Reused across happy-path
///         transfer/revoke tests and parameterized to let "tampered field"
///         tests mutate exactly one field at a time.
library OracleSigner {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    struct ProofInputs {
        IAgentNFT.OracleAction action;
        uint256 tokenId;
        address from;
        address to;
        bytes32 newPointer;
        bytes32 dataHash;
        uint256 nonce;
    }

    /// @notice Compute the EIP-712 domain separator the AgentNFT contract uses.
    function domainSeparator(address verifyingContract, uint256 chainId) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                OracleProofTypeHashes.DOMAIN_TYPEHASH,
                OracleProofTypeHashes.DOMAIN_NAME_HASH,
                OracleProofTypeHashes.DOMAIN_VERSION_HASH,
                chainId,
                verifyingContract
            )
        );
    }

    /// @notice Compute the EIP-712 digest the oracle key signs.
    function digest(address verifyingContract, uint256 chainId, ProofInputs memory p)
        internal
        pure
        returns (bytes32)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                OracleProofTypeHashes.ORACLE_PROOF_TYPEHASH,
                uint8(p.action),
                p.tokenId,
                p.from,
                p.to,
                p.newPointer,
                p.dataHash,
                p.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(verifyingContract, chainId), structHash));
    }

    /// @notice Sign the proof with `oraclePk` and return the encoded
    ///         `bytes` payload that AgentNFT expects.
    function sign(address verifyingContract, uint256 chainId, uint256 oraclePk, ProofInputs memory p)
        internal
        pure
        returns (bytes memory encoded)
    {
        bytes32 d = digest(verifyingContract, chainId, p);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(oraclePk, d);
        bytes memory signature = abi.encodePacked(r, s, v);

        IAgentNFT.OracleProof memory proof = IAgentNFT.OracleProof({
            action: p.action,
            tokenId: p.tokenId,
            from: p.from,
            to: p.to,
            newPointer: p.newPointer,
            dataHash: p.dataHash,
            nonce: p.nonce,
            signature: signature
        });
        return abi.encode(proof);
    }
}
