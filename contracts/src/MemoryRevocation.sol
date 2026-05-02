// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {IMemoryRevocation} from "./interfaces/IMemoryRevocation.sol";

/// @title MemoryRevocation
/// @notice Public registry of revoked agent memory keys for SovereignClaw.
/// @dev See IMemoryRevocation for the full contract. This implementation is
///      intentionally minimal:
///      - No upgradability. Redeploy if logic changes.
///      - No admin role. The bound AgentNFT is the only writer, set in the
///        constructor and immutable thereafter.
///      - No signature verification. AgentNFT.revoke() verifies upstream.
contract MemoryRevocation is IMemoryRevocation {
    /// @inheritdoc IMemoryRevocation
    bytes32 public constant DESTROYED_SENTINEL = keccak256("SOVEREIGNCLAW:DESTROYED:v1");

    /// @inheritdoc IMemoryRevocation
    address public immutable agentNFT;

    mapping(uint256 => Revocation) private _revocations;

    /// @param _agentNFT The AgentNFT contract authorized to write to this
    ///        registry. Cannot be zero. Cannot be changed after deployment.
    constructor(address _agentNFT) {
        if (_agentNFT == address(0)) revert InvalidAgentNFT();
        agentNFT = _agentNFT;
    }

    // -------------------------------------------------------------------------
    // Mutating
    // -------------------------------------------------------------------------

    /// @inheritdoc IMemoryRevocation
    function revoke(uint256 tokenId, bytes32 oldKeyHash, address revokedBy) external {
        if (msg.sender != agentNFT) revert NotAgentNFT(msg.sender);

        if (_revocations[tokenId].timestamp != 0) {
            revert AlreadyRevoked(tokenId);
        }

        uint64 ts = uint64(block.timestamp);
        _revocations[tokenId] = Revocation({
            tokenId: tokenId,
            oldKeyHash: oldKeyHash,
            newKeyHash: DESTROYED_SENTINEL,
            timestamp: ts,
            revokedBy: revokedBy
        });

        emit Revoked(tokenId, revokedBy, oldKeyHash, ts);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @inheritdoc IMemoryRevocation
    function isRevoked(uint256 tokenId) external view returns (bool) {
        return _revocations[tokenId].timestamp != 0;
    }

    /// @inheritdoc IMemoryRevocation
    function getRevocation(uint256 tokenId) external view returns (Revocation memory) {
        Revocation memory record = _revocations[tokenId];
        if (record.timestamp == 0) revert NotRevoked(tokenId);
        return record;
    }
}
