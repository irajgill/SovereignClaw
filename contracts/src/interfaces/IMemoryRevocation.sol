// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @title IMemoryRevocation
/// @notice Public registry of revoked agent memory keys. Anyone can verify a
///         token's memory has been cryptographically decommissioned.
/// @dev Only the bound `AgentNFT` contract may write to this registry. The
///      address of that contract is fixed at deployment and cannot change.
///      This is a stronger guarantee than the original spec: an oracle
///      compromise cannot poison the revocation registry, only AgentNFT can,
///      and AgentNFT only does so when its own owner-signature check passes.
interface IMemoryRevocation {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice One revocation record. Once written, fields are immutable.
    /// @param tokenId The AgentNFT token whose memory was revoked.
    /// @param oldKeyHash keccak256 of the wrapped DEK that was destroyed.
    ///                   Lets observers prove which key was decommissioned
    ///                   without revealing it.
    /// @param newKeyHash The DESTROYED_SENTINEL constant. Present so the
    ///                   record shape can be reused by future versions that
    ///                   support key rotation rather than full destruction.
    /// @param timestamp Block timestamp at revocation, as `uint64`.
    /// @param revokedBy The wallet that triggered revocation (the token
    ///                  owner at the time AgentNFT.revoke was called).
    struct Revocation {
        uint256 tokenId;
        bytes32 oldKeyHash;
        bytes32 newKeyHash;
        uint64 timestamp;
        address revokedBy;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted exactly once per token, when its memory is revoked.
    event Revoked(uint256 indexed tokenId, address indexed revokedBy, bytes32 oldKeyHash, uint64 timestamp);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    /// @notice Caller is not the bound AgentNFT contract.
    error NotAgentNFT(address caller);

    /// @notice Token has already been revoked. Revocation is irreversible.
    error AlreadyRevoked(uint256 tokenId);

    /// @notice Queried token has no revocation record.
    error NotRevoked(uint256 tokenId);

    /// @notice The bound AgentNFT address passed to the constructor was zero.
    error InvalidAgentNFT();

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @notice The sentinel value written into `newKeyHash` to indicate the
    ///         DEK has been destroyed (not rotated). Equal to
    ///         keccak256("SOVEREIGNCLAW:DESTROYED:v1").
    function DESTROYED_SENTINEL() external view returns (bytes32);

    /// @notice The AgentNFT contract that may write to this registry.
    ///         Immutable after construction.
    function agentNFT() external view returns (address);

    // -------------------------------------------------------------------------
    // Mutating functions
    // -------------------------------------------------------------------------

    /// @notice Record a revocation. Callable only by the bound AgentNFT.
    /// @dev AgentNFT is responsible for verifying owner authority before
    ///      calling this. This contract performs no signature checks of
    ///      its own; it trusts the caller, which is fixed at deploy time.
    /// @param tokenId The token being revoked.
    /// @param oldKeyHash keccak256 of the wrappedDEK that is being destroyed.
    /// @param revokedBy The wallet on whose behalf revocation was triggered.
    /// @custom:reverts NotAgentNFT if msg.sender != agentNFT
    /// @custom:reverts AlreadyRevoked if this token already has a record
    function revoke(uint256 tokenId, bytes32 oldKeyHash, address revokedBy) external;

    // -------------------------------------------------------------------------
    // View functions
    // -------------------------------------------------------------------------

    /// @notice True if the token has been revoked. Cheap to call.
    function isRevoked(uint256 tokenId) external view returns (bool);

    /// @notice Full revocation record. Reverts if the token has not been revoked.
    /// @custom:reverts NotRevoked if the token has no record.
    function getRevocation(uint256 tokenId) external view returns (Revocation memory);
}
