// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {AgentNFT} from "../src/AgentNFT.sol";
import {MemoryRevocation} from "../src/MemoryRevocation.sol";
import {IAgentNFT} from "../src/interfaces/IAgentNFT.sol";
import {OracleSigner} from "./helpers/OracleSigner.sol";

/// @notice Handler that performs randomized mint / transfer / revoke calls,
///         tracking every minted token id so invariants can sweep them.
contract AgentHandler is Test {
    AgentNFT public immutable nft;
    uint256 public immutable oraclePk;

    uint256[] public tokenIds;
    mapping(uint256 => address) public currentOwner;
    mapping(uint256 => bool) public seenRevoked;
    mapping(uint256 => uint256) public lastSeenNonce;

    address[] internal actors;

    constructor(AgentNFT _nft, uint256 _oraclePk, address[] memory _actors) {
        nft = _nft;
        oraclePk = _oraclePk;
        actors = _actors;
    }

    function _actor(uint256 idx) internal view returns (address) {
        return actors[idx % actors.length];
    }

    function mint(uint256 actorSeed, uint16 royalty) external {
        royalty = uint16(bound(uint256(royalty), 0, 10_000));
        address to = _actor(actorSeed);

        uint256 id = nft.mint(
            to,
            "role",
            keccak256(abi.encode(actorSeed, royalty, tokenIds.length)),
            bytes32(uint256(0xAAAA + tokenIds.length)),
            abi.encodePacked(uint256(actorSeed)),
            royalty
        );
        tokenIds.push(id);
        currentOwner[id] = to;
    }

    function transfer(uint256 idSeed, uint256 actorSeed) external {
        if (tokenIds.length == 0) return;
        uint256 id = tokenIds[idSeed % tokenIds.length];
        address from = currentOwner[id];
        address to = _actor(actorSeed);
        if (from == address(0) || to == address(0) || from == to) return;
        if (nft.getAgent(id).revoked) return;

        bytes memory newDek = abi.encodePacked(uint256(actorSeed), idSeed);
        bytes32 newPointer = keccak256(abi.encode(id, actorSeed));
        uint256 nonce = nft.tokenNonce(id);

        bytes memory proof = OracleSigner.sign(
            address(nft),
            block.chainid,
            oraclePk,
            OracleSigner.ProofInputs({
                action: IAgentNFT.OracleAction.Transfer,
                tokenId: id,
                from: from,
                to: to,
                newPointer: newPointer,
                dataHash: keccak256(newDek),
                nonce: nonce
            })
        );

        vm.prank(from);
        nft.transferWithReencryption(to, id, newPointer, newDek, proof);
        currentOwner[id] = to;
        lastSeenNonce[id] = nonce + 1;
    }

    function revoke(uint256 idSeed) external {
        if (tokenIds.length == 0) return;
        uint256 id = tokenIds[idSeed % tokenIds.length];
        address owner_ = currentOwner[id];
        if (owner_ == address(0)) return;
        if (nft.getAgent(id).revoked) return;

        bytes32 oldKeyHash = keccak256(nft.getAgent(id).wrappedDEK);
        uint256 nonce = nft.tokenNonce(id);

        bytes memory proof = OracleSigner.sign(
            address(nft),
            block.chainid,
            oraclePk,
            OracleSigner.ProofInputs({
                action: IAgentNFT.OracleAction.Revoke,
                tokenId: id,
                from: owner_,
                to: owner_,
                newPointer: bytes32(0),
                dataHash: oldKeyHash,
                nonce: nonce
            })
        );

        vm.prank(owner_);
        nft.revoke(id, oldKeyHash, proof);
        seenRevoked[id] = true;
        lastSeenNonce[id] = nonce + 1;
    }

    function tokenIdsLength() external view returns (uint256) {
        return tokenIds.length;
    }
}

contract AgentNFTInvariantTest is StdInvariant, Test {
    AgentNFT internal nft;
    MemoryRevocation internal registry;
    AgentHandler internal handler;
    uint256 internal oraclePk;
    address internal oracle;

    function setUp() public {
        (oracle, oraclePk) = makeAddrAndKey("oracle");
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        registry = new MemoryRevocation(predicted);
        nft = new AgentNFT(address(registry), oracle, "n", "s");
        require(address(nft) == predicted, "create-address mismatch");

        address[] memory actors = new address[](4);
        actors[0] = makeAddr("a1");
        actors[1] = makeAddr("a2");
        actors[2] = makeAddr("a3");
        actors[3] = makeAddr("a4");

        handler = new AgentHandler(nft, oraclePk, actors);
        targetContract(address(handler));
    }

    /// @notice Once a token is revoked, no sequence of calls can flip it back.
    function invariant_revokedTokensStayRevoked() public view {
        uint256 n = handler.tokenIdsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.tokenIds(i);
            if (handler.seenRevoked(id)) {
                IAgentNFT.Agent memory a = nft.getAgent(id);
                assertTrue(a.revoked, "revoked token came back");
                assertEq(a.wrappedDEK.length, 0, "wrappedDEK reappeared");
                assertTrue(registry.isRevoked(id), "registry forgot");
            }
        }
    }

    /// @notice Per-token nonce is monotonic non-decreasing across all calls.
    function invariant_nonceMonotonic() public view {
        uint256 n = handler.tokenIdsLength();
        for (uint256 i; i < n; ++i) {
            uint256 id = handler.tokenIds(i);
            uint256 onChain = nft.tokenNonce(id);
            uint256 known = handler.lastSeenNonce(id);
            assertGe(onChain, known, "nonce went backwards");
        }
    }
}
