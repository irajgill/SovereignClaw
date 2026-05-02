// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MemoryRevocation} from "../src/MemoryRevocation.sol";
import {IMemoryRevocation} from "../src/interfaces/IMemoryRevocation.sol";

contract MemoryRevocationTest is Test {
    MemoryRevocation internal registry;
    address internal constant AGENT_NFT = address(0xA9E47);
    address internal constant ALICE = address(0xA11CE);

    event Revoked(uint256 indexed tokenId, address indexed revokedBy, bytes32 oldKeyHash, uint64 timestamp);

    function setUp() public {
        registry = new MemoryRevocation(AGENT_NFT);
    }

    // --- Constructor ---------------------------------------------------------

    function test_constructor_setsImmutableAgentNFT() public view {
        assertEq(registry.agentNFT(), AGENT_NFT);
    }

    function test_constructor_revertsOnZeroAgentNFT() public {
        vm.expectRevert(IMemoryRevocation.InvalidAgentNFT.selector);
        new MemoryRevocation(address(0));
    }

    function test_destroyedSentinel_isStable() public view {
        assertEq(registry.DESTROYED_SENTINEL(), keccak256("SOVEREIGNCLAW:DESTROYED:v1"));
    }

    // --- revoke() happy path -------------------------------------------------

    function test_revoke_emitsRevokedEvent() public {
        bytes32 keyHash = keccak256("dek-7");
        vm.warp(1_700_000_000);

        vm.expectEmit(true, true, false, true, address(registry));
        emit Revoked(7, ALICE, keyHash, uint64(block.timestamp));

        vm.prank(AGENT_NFT);
        registry.revoke(7, keyHash, ALICE);
    }

    function test_revoke_writesFullRecord() public {
        bytes32 keyHash = keccak256("dek-42");
        vm.warp(1_800_000_000);

        vm.prank(AGENT_NFT);
        registry.revoke(42, keyHash, ALICE);

        IMemoryRevocation.Revocation memory r = registry.getRevocation(42);
        assertEq(r.tokenId, 42);
        assertEq(r.oldKeyHash, keyHash);
        assertEq(r.newKeyHash, registry.DESTROYED_SENTINEL());
        assertEq(uint256(r.timestamp), block.timestamp);
        assertEq(r.revokedBy, ALICE);
    }

    function test_isRevoked_togglesOnFirstRevoke() public {
        assertFalse(registry.isRevoked(1));
        vm.prank(AGENT_NFT);
        registry.revoke(1, bytes32(uint256(0xdeadbeef)), ALICE);
        assertTrue(registry.isRevoked(1));
    }

    // --- Access control ------------------------------------------------------

    function test_revoke_revertsOnNonAgentNFT() public {
        vm.expectRevert(abi.encodeWithSelector(IMemoryRevocation.NotAgentNFT.selector, address(this)));
        registry.revoke(1, bytes32(0), ALICE);
    }

    function testFuzz_revoke_revertsOnAnyNonAgentNFTCaller(address caller) public {
        vm.assume(caller != AGENT_NFT);
        vm.expectRevert(abi.encodeWithSelector(IMemoryRevocation.NotAgentNFT.selector, caller));
        vm.prank(caller);
        registry.revoke(1, bytes32(0), ALICE);
    }

    // --- Idempotence / double-revoke -----------------------------------------

    function test_revoke_revertsOnDoubleRevoke() public {
        vm.prank(AGENT_NFT);
        registry.revoke(5, bytes32(uint256(1)), ALICE);

        vm.prank(AGENT_NFT);
        vm.expectRevert(abi.encodeWithSelector(IMemoryRevocation.AlreadyRevoked.selector, uint256(5)));
        registry.revoke(5, bytes32(uint256(2)), ALICE);
    }

    // --- View error semantics ------------------------------------------------

    function test_getRevocation_revertsForUnknownToken() public {
        vm.expectRevert(abi.encodeWithSelector(IMemoryRevocation.NotRevoked.selector, uint256(999)));
        registry.getRevocation(999);
    }

    function test_isRevoked_returnsFalseForUnknownToken() public view {
        assertFalse(registry.isRevoked(123_456));
    }
}
