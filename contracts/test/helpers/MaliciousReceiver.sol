// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {IAgentNFT} from "../../src/interfaces/IAgentNFT.sol";

/// @notice Re-entry attacker. On `onERC721Received`, attempts to re-enter
///         `transferWithReencryption`. The nonReentrant guard must abort it.
contract MaliciousReceiver {
    IAgentNFT public immutable nft;
    bool public reentered;

    constructor(IAgentNFT _nft) {
        nft = _nft;
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        // Re-entry attempt; expected to revert from the nonReentrant guard.
        try nft.transferWithReencryption(address(this), tokenId, bytes32(0), "", "") {
            reentered = true;
        } catch {
            // Swallow so the outer call's nonReentrant revert is the visible failure.
        }
        return this.onERC721Received.selector;
    }
}
