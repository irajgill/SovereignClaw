// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

/// @title IAgentNFT
/// @notice ERC-7857-style iNFT: mints AI agents, transfers them via TEE-oracle
///         re-encryption, revokes their memory irrevocably, and emits royalty
///         events on usage.
/// @dev Standard ERC-721 transfers (`transferFrom`, `safeTransferFrom`,
///      `approve`, `setApprovalForAll`) are explicitly disabled. All
///      ownership changes must go through `transferWithReencryption` so
///      the oracle can re-wrap the DEK for the new owner.
interface IAgentNFT {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    /// @notice On-chain record of one agent. `wrappedDEK` is the DEK encrypted
    ///         under the current owner's pubkey; nobody else can derive it.
    /// @dev Storage layout is intentionally slot-packed: `mintedAt`,
    ///      `royaltyBps`, and `revoked` share a slot.
    /// @param metadataHash Hash of the canonical agent config + pointer.
    /// @param encryptedPointer 0G Storage Log root hash pointing at the
    ///                         encrypted memory blob.
    /// @param wrappedDEK DEK wrapped under owner pubkey. Up to 2048 bytes.
    ///                   Zeroed irrevocably on revoke().
    /// @param mintedAt Block timestamp at mint.
    /// @param royaltyBps Basis points (0..10000) of usage royalty.
    /// @param revoked True after revoke(); cannot be unset.
    /// @param role Free-form role label, max 64 bytes.
    struct Agent {
        bytes32 metadataHash;
        bytes32 encryptedPointer;
        bytes wrappedDEK;
        uint64 mintedAt;
        uint16 royaltyBps;
        bool revoked;
        string role;
    }

    /// @notice Discriminator inside an oracle proof. Distinguishes a transfer
    ///         attestation from a revoke attestation.
    enum OracleAction {
        Transfer,
        Revoke
    }

    /// @notice ABI-decoded shape of the `oracleProof` parameter on
    ///         `transferWithReencryption` and `revoke`.
    /// @dev Encoded as `abi.encode(OracleProof)`. The contract reconstructs
    ///      the EIP-712 digest from these fields plus token nonce, then
    ///      `ecrecover`s the signature against the stored oracle address.
    /// @param action Which action this proof attests to.
    /// @param tokenId The token the proof is bound to.
    /// @param from Current owner. Must match `ownerOf(tokenId)` at call time.
    /// @param to New owner (Transfer) or the revoker (Revoke; equals from).
    /// @param newPointer New encrypted pointer (Transfer) or zeroed (Revoke).
    /// @param dataHash newWrappedDEK hash (Transfer) or oldKeyHash (Revoke).
    /// @param nonce Must equal `tokenNonce[tokenId]` exactly.
    /// @param signature 65-byte ECDSA sig from the oracle key.
    struct OracleProof {
        OracleAction action;
        uint256 tokenId;
        address from;
        address to;
        bytes32 newPointer;
        bytes32 dataHash;
        uint256 nonce;
        bytes signature;
    }

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    /// @notice Emitted on successful mint.
    event Minted(uint256 indexed tokenId, address indexed owner, string role, bytes32 metadataHash);

    /// @notice Emitted on successful re-encryption transfer.
    /// @dev Distinct from the standard ERC-721 `Transfer` event, which is also
    ///      emitted under the same call by OZ's `_transfer`.
    event Transferred(uint256 indexed tokenId, address indexed from, address indexed to, bytes32 newPointer);

    /// @notice Emitted exactly once per token, when its memory is revoked.
    event Revoked(uint256 indexed tokenId, address indexed revokedBy);

    /// @notice Emitted by `recordUsage`. Off-chain royalty splitters listen for this.
    event UsageRecorded(uint256 indexed tokenId, address indexed payer, uint256 amount, uint16 royaltyBps);

    /// @notice Emitted when the admin authorizes/deauthorizes a usage reporter.
    event UsageAuthorizationChanged(uint256 indexed tokenId, address indexed user, bool allowed);

    /// @notice Emitted when the admin rotates the oracle address.
    event OracleChanged(address indexed previousOracle, address indexed newOracle);

    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------

    error InvalidRecipient();
    error InvalidMetadataHash();
    error InvalidOracle();
    error InvalidRevocationRegistry();
    error WrappedDEKTooLarge(uint256 length);
    error RoleTooLong(uint256 length);
    error RoyaltyTooHigh(uint16 royaltyBps);
    error TokenDoesNotExist(uint256 tokenId);
    error TokenRevoked(uint256 tokenId);
    error NotTokenOwner(uint256 tokenId, address caller);
    error UsageNotAuthorized(uint256 tokenId, address caller);
    error UseTransferWithReencryption();
    error InvalidOracleProof();
    error WrongOracleAction(OracleAction expected, OracleAction got);
    error TokenIdMismatch(uint256 expected, uint256 got);
    error FromMismatch(address expected, address got);
    error ToMismatch(address expected, address got);
    error PointerMismatch(bytes32 expected, bytes32 got);
    error DataHashMismatch(bytes32 expected, bytes32 got);
    error InvalidNonce(uint256 expected, uint256 got);
    error MalformedSignature(uint256 length);

    // -------------------------------------------------------------------------
    // Storage accessors
    // -------------------------------------------------------------------------

    /// @notice Address whose key signs OracleProofs. Settable by admin.
    function oracle() external view returns (address);

    /// @notice The MemoryRevocation registry this contract writes to.
    /// @dev Immutable after construction.
    function revocationRegistry() external view returns (address);

    /// @notice Per-token monotonic counter. Incremented after each successful
    ///         `transferWithReencryption` or `revoke`.
    function tokenNonce(uint256 tokenId) external view returns (uint256);

    /// @notice Whether `user` may call `recordUsage` on `tokenId`. The token
    ///         owner is implicitly authorized in addition to this map.
    function usageAuthorized(uint256 tokenId, address user) external view returns (bool);

    /// @notice Full agent record. Reverts if the token does not exist.
    /// @custom:reverts TokenDoesNotExist
    function getAgent(uint256 tokenId) external view returns (Agent memory);

    // -------------------------------------------------------------------------
    // Mutating functions
    // -------------------------------------------------------------------------

    /// @notice Mint a new agent iNFT.
    /// @param to Initial owner. Must be non-zero.
    /// @param role Free-form role label, max 64 bytes.
    /// @param metadataHash Non-zero hash of canonical agent config.
    /// @param encryptedPointer 0G Storage root hash for the encrypted memory.
    /// @param wrappedDEK DEK wrapped under `to`'s pubkey. Max 2048 bytes.
    /// @param royaltyBps Royalty in basis points (0..10000).
    /// @return tokenId The freshly minted token id.
    function mint(
        address to,
        string calldata role,
        bytes32 metadataHash,
        bytes32 encryptedPointer,
        bytes calldata wrappedDEK,
        uint16 royaltyBps
    ) external returns (uint256 tokenId);

    /// @notice Transfer a token to a new owner, atomically rotating the
    ///         encrypted memory pointer and re-wrapping the DEK.
    function transferWithReencryption(
        address to,
        uint256 tokenId,
        bytes32 newPointer,
        bytes calldata newWrappedDEK,
        bytes calldata oracleProof
    ) external;

    /// @notice Permanently revoke the agent's memory key.
    /// @param tokenId The token to revoke.
    /// @param oldKeyHash keccak256 of the wrappedDEK being destroyed; must
    ///                   equal the proof's dataHash.
    /// @param oracleProof Proof binding the revocation.
    function revoke(uint256 tokenId, bytes32 oldKeyHash, bytes calldata oracleProof) external;

    /// @notice Emit a `UsageRecorded` event for off-chain royalty splitters.
    ///         Does not transfer funds; accounting is downstream.
    function recordUsage(uint256 tokenId, address payer, uint256 amount) external;

    /// @notice Authorize or deauthorize an address to call `recordUsage` on a token.
    function authorizeUsage(uint256 tokenId, address user, bool allowed) external;

    /// @notice Rotate the oracle address. Admin-only.
    function setOracle(address newOracle) external;
}
