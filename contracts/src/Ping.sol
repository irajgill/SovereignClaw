// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @title Ping
/// @notice Phase 0 throwaway contract. Replaced by AgentNFT.sol in Phase 2.
/// @dev Exists only to prove the deploy/call/event pipeline works end-to-end
/// on 0G Galileo testnet.
contract Ping {
    event Pinged(address indexed from, string message, uint256 timestamp);

    function ping(string calldata message) external returns (uint256) {
        emit Pinged(msg.sender, message, block.timestamp);
        return block.timestamp;
    }
}
