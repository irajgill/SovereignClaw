// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {AgentNFT} from "../src/AgentNFT.sol";
import {MemoryRevocation} from "../src/MemoryRevocation.sol";
import {IAgentNFT} from "../src/interfaces/IAgentNFT.sol";

contract AgentNFTFuzzTest is Test {
    AgentNFT internal nft;
    MemoryRevocation internal registry;
    address internal oracle;

    address internal alice = makeAddr("alice");
    bytes32 internal constant METADATA = bytes32(uint256(0x1234));
    bytes32 internal constant POINTER = bytes32(uint256(0xAAAA));

    function setUp() public {
        oracle = makeAddr("oracle");
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        registry = new MemoryRevocation(predicted);
        nft = new AgentNFT(address(registry), oracle, "n", "s");
        require(address(nft) == predicted, "create-address mismatch");
    }

    function testFuzz_royaltyBps_acceptsInRange(uint16 bps) public {
        bps = uint16(bound(uint256(bps), 0, 10_000));
        uint256 id = nft.mint(alice, "r", METADATA, POINTER, hex"01", bps);
        assertEq(uint256(nft.getAgent(id).royaltyBps), uint256(bps));
    }

    function testFuzz_royaltyBps_rejectsOutOfRange(uint16 bps) public {
        vm.assume(bps > 10_000);
        vm.expectRevert(abi.encodeWithSelector(IAgentNFT.RoyaltyTooHigh.selector, bps));
        nft.mint(alice, "r", METADATA, POINTER, hex"01", bps);
    }

    function testFuzz_wrappedDEKLength_acceptsInRange(uint16 lenSeed) public {
        uint256 len = bound(uint256(lenSeed), 0, 2048);
        bytes memory dek = new bytes(len);
        for (uint256 i; i < len; ++i) dek[i] = bytes1(uint8(i));
        uint256 id = nft.mint(alice, "r", METADATA, POINTER, dek, 0);
        assertEq(nft.getAgent(id).wrappedDEK.length, len);
    }

    function testFuzz_wrappedDEKLength_rejectsOversize(uint16 over) public {
        uint256 len = 2049 + bound(uint256(over), 0, 1024);
        bytes memory dek = new bytes(len);
        vm.expectRevert(abi.encodeWithSelector(IAgentNFT.WrappedDEKTooLarge.selector, len));
        nft.mint(alice, "r", METADATA, POINTER, dek, 0);
    }

    function testFuzz_roleLength_acceptsInRange(uint8 lenSeed) public {
        uint256 len = bound(uint256(lenSeed), 0, 64);
        bytes memory role = new bytes(len);
        for (uint256 i; i < len; ++i) role[i] = "x";
        uint256 id = nft.mint(alice, string(role), METADATA, POINTER, hex"01", 0);
        assertEq(bytes(nft.getAgent(id).role).length, len);
    }

    function testFuzz_roleLength_rejectsOversize(uint8 over) public {
        uint256 len = 65 + bound(uint256(over), 0, 200);
        bytes memory role = new bytes(len);
        for (uint256 i; i < len; ++i) role[i] = "x";
        vm.expectRevert(abi.encodeWithSelector(IAgentNFT.RoleTooLong.selector, len));
        nft.mint(alice, string(role), METADATA, POINTER, hex"01", 0);
    }
}
