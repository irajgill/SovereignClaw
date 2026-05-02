// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {OracleProofTypeHashes} from "../src/interfaces/IOracle.sol";
import {AgentNFT} from "../src/AgentNFT.sol";
import {MemoryRevocation} from "../src/MemoryRevocation.sol";

/// @notice Emits a JSON fixture with the EIP-712 type-hash constants and the
///         domain-name/version hashes that AgentNFT uses. Off-chain code in
///         packages/inft and apps/backend imports this JSON to assert that
///         the TS-computed digest is byte-identical to what the on-chain
///         contract reconstructs in `_verifyOracleProof`.
///
/// @dev    Runs as part of the regular Foundry test suite. Output:
///         deployments/eip712-typehashes.json (relative to repo root via the
///         "../" prefix; Foundry's vm.writeFile resolves from project root).
contract EmitTypeHashes is Test {
    function test_emit_typehashes() public {
        bytes32 oracleTypehash = OracleProofTypeHashes.ORACLE_PROOF_TYPEHASH;
        bytes32 domainTypehash = OracleProofTypeHashes.DOMAIN_TYPEHASH;
        bytes32 domainNameHash = OracleProofTypeHashes.DOMAIN_NAME_HASH;
        bytes32 domainVersionHash = OracleProofTypeHashes.DOMAIN_VERSION_HASH;

        // Sanity: assert the canonical strings hash to the same values. If any
        // line below ever drifts from the library, this test fails before the
        // fixture is written, and CI catches it.
        assertEq(
            oracleTypehash,
            keccak256(
                "OracleProof(uint8 action,uint256 tokenId,address from,address to,"
                "bytes32 newPointer,bytes32 dataHash,uint256 nonce)"
            ),
            "ORACLE_PROOF_TYPEHASH drift"
        );
        assertEq(
            domainTypehash,
            keccak256(
                "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
            ),
            "DOMAIN_TYPEHASH drift"
        );
        assertEq(domainNameHash, keccak256(bytes("SovereignClaw AgentNFT")), "DOMAIN_NAME_HASH drift");
        assertEq(domainVersionHash, keccak256(bytes("1")), "DOMAIN_VERSION_HASH drift");

        string memory json = string.concat(
            "{\n",
            '  "ORACLE_PROOF_TYPEHASH": "',
            vm.toString(oracleTypehash),
            '",\n  "DOMAIN_TYPEHASH": "',
            vm.toString(domainTypehash),
            '",\n  "DOMAIN_NAME_HASH": "',
            vm.toString(domainNameHash),
            '",\n  "DOMAIN_VERSION_HASH": "',
            vm.toString(domainVersionHash),
            '",\n  "DOMAIN_NAME_LITERAL": "SovereignClaw AgentNFT",\n',
            '  "DOMAIN_VERSION_LITERAL": "1",\n',
            '  "ORACLE_PROOF_TYPE_LITERAL": "OracleProof(uint8 action,uint256 tokenId,address from,address to,bytes32 newPointer,bytes32 dataHash,uint256 nonce)"\n',
            "}\n"
        );
        vm.writeFile("../deployments/eip712-typehashes.json", json);
    }
}
