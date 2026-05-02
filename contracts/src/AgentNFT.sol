// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

import {ERC721} from "openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {Ownable2Step} from "openzeppelin-contracts/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {Strings} from "openzeppelin-contracts/contracts/utils/Strings.sol";

import {IAgentNFT} from "./interfaces/IAgentNFT.sol";
import {IMemoryRevocation} from "./interfaces/IMemoryRevocation.sol";
import {OracleProofTypeHashes} from "./interfaces/IOracle.sol";

/// @title AgentNFT
/// @notice ERC-7857-style iNFT for SovereignClaw agents.
/// @dev Trust model:
///      - Per-token wrappedDEK is stored on-chain and rotated by the oracle on
///        every transfer. The oracle signs an EIP-712 typed-data proof binding
///        (action, tokenId, from, to, newPointer, dataHash, nonce); the
///        contract `ecrecover`s the proof against the stored oracle address.
///      - Standard ERC-721 transfer paths are disabled. Skipping the oracle
///        would leave the new owner unable to read agent memory.
///      - revoke() zeroes wrappedDEK, marks the token revoked, and writes to
///        the bound MemoryRevocation registry. The registry binding is fixed
///        at construction.
///      - Owner-of-this-contract is the admin. Used only to rotate the oracle
///        address. Ownable2Step is used so a typo can't lock out the admin.
contract AgentNFT is IAgentNFT, ERC721, Ownable2Step, ReentrancyGuard {
    using ECDSA for bytes32;

    // -------------------------------------------------------------------------
    // Constants / immutables
    // -------------------------------------------------------------------------

    uint256 public constant MAX_WRAPPED_DEK_BYTES = 2048;
    uint256 public constant MAX_ROLE_BYTES = 64;
    uint16 public constant MAX_ROYALTY_BPS = 10_000;

    /// @inheritdoc IAgentNFT
    address public immutable revocationRegistry;

    bytes32 private immutable _DOMAIN_SEPARATOR;
    uint256 private immutable _CACHED_CHAIN_ID;

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentNFT
    address public oracle;

    mapping(uint256 => Agent) private _agents;

    /// @inheritdoc IAgentNFT
    mapping(uint256 => uint256) public tokenNonce;

    /// @inheritdoc IAgentNFT
    mapping(uint256 => mapping(address => bool)) public usageAuthorized;

    /// @dev Token ids start at 1; 0 reserved as "none". Using a counter is
    ///      cheaper than a mapping-of-existence check elsewhere.
    uint256 private _nextTokenId = 1;

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    /// @param _revocationRegistry The bound MemoryRevocation contract. Cannot
    ///        be zero. Cannot be changed after deployment.
    /// @param _oracle Initial oracle address. Cannot be zero. Rotatable via
    ///        `setOracle`.
    /// @param name_ ERC-721 collection name.
    /// @param symbol_ ERC-721 collection symbol.
    constructor(address _revocationRegistry, address _oracle, string memory name_, string memory symbol_)
        ERC721(name_, symbol_)
        Ownable(msg.sender)
    {
        if (_revocationRegistry == address(0)) revert InvalidRevocationRegistry();
        if (_oracle == address(0)) revert InvalidOracle();

        revocationRegistry = _revocationRegistry;
        oracle = _oracle;
        emit OracleChanged(address(0), _oracle);

        _CACHED_CHAIN_ID = block.chainid;
        _DOMAIN_SEPARATOR = _computeDomainSeparator(block.chainid);
    }

    // -------------------------------------------------------------------------
    // Mint
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentNFT
    function mint(
        address to,
        string calldata role,
        bytes32 metadataHash,
        bytes32 encryptedPointer,
        bytes calldata wrappedDEK,
        uint16 royaltyBps
    ) external returns (uint256 tokenId) {
        if (to == address(0)) revert InvalidRecipient();
        if (metadataHash == bytes32(0)) revert InvalidMetadataHash();
        if (royaltyBps > MAX_ROYALTY_BPS) revert RoyaltyTooHigh(royaltyBps);
        if (wrappedDEK.length > MAX_WRAPPED_DEK_BYTES) revert WrappedDEKTooLarge(wrappedDEK.length);
        if (bytes(role).length > MAX_ROLE_BYTES) revert RoleTooLong(bytes(role).length);

        tokenId = _nextTokenId++;

        _agents[tokenId] = Agent({
            metadataHash: metadataHash,
            encryptedPointer: encryptedPointer,
            wrappedDEK: wrappedDEK,
            mintedAt: uint64(block.timestamp),
            royaltyBps: royaltyBps,
            revoked: false,
            role: role
        });

        _safeMint(to, tokenId);

        emit Minted(tokenId, to, role, metadataHash);
    }

    // -------------------------------------------------------------------------
    // Transfer with re-encryption
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentNFT
    function transferWithReencryption(
        address to,
        uint256 tokenId,
        bytes32 newPointer,
        bytes calldata newWrappedDEK,
        bytes calldata oracleProof
    ) external nonReentrant {
        if (to == address(0)) revert InvalidRecipient();
        if (newWrappedDEK.length > MAX_WRAPPED_DEK_BYTES) revert WrappedDEKTooLarge(newWrappedDEK.length);

        address from = _requireOwned(tokenId);
        if (from != msg.sender) revert NotTokenOwner(tokenId, msg.sender);

        Agent storage agent = _agents[tokenId];
        if (agent.revoked) revert TokenRevoked(tokenId);

        OracleProof memory proof = abi.decode(oracleProof, (OracleProof));
        bytes32 expectedDataHash = keccak256(newWrappedDEK);

        _verifyOracleProof(
            proof,
            OracleAction.Transfer,
            tokenId,
            from,
            to,
            newPointer,
            expectedDataHash
        );

        agent.encryptedPointer = newPointer;
        agent.wrappedDEK = newWrappedDEK;
        unchecked {
            tokenNonce[tokenId] = proof.nonce + 1;
        }

        // _transfer fires the standard ERC721 Transfer event.
        _transfer(from, to, tokenId);

        emit Transferred(tokenId, from, to, newPointer);
    }

    // -------------------------------------------------------------------------
    // Revoke
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentNFT
    function revoke(uint256 tokenId, bytes32 oldKeyHash, bytes calldata oracleProof) external nonReentrant {
        address owner_ = _requireOwned(tokenId);
        if (owner_ != msg.sender) revert NotTokenOwner(tokenId, msg.sender);

        Agent storage agent = _agents[tokenId];
        if (agent.revoked) revert TokenRevoked(tokenId);

        OracleProof memory proof = abi.decode(oracleProof, (OracleProof));

        _verifyOracleProof(
            proof,
            OracleAction.Revoke,
            tokenId,
            owner_,
            owner_,
            bytes32(0),
            oldKeyHash
        );

        agent.revoked = true;
        delete agent.wrappedDEK;
        unchecked {
            tokenNonce[tokenId] = proof.nonce + 1;
        }

        IMemoryRevocation(revocationRegistry).revoke(tokenId, oldKeyHash, owner_);

        emit Revoked(tokenId, owner_);
    }

    // -------------------------------------------------------------------------
    // Usage / royalties
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentNFT
    function recordUsage(uint256 tokenId, address payer, uint256 amount) external nonReentrant {
        address owner_ = _requireOwned(tokenId);

        Agent storage agent = _agents[tokenId];
        if (agent.revoked) revert TokenRevoked(tokenId);

        if (msg.sender != owner_ && !usageAuthorized[tokenId][msg.sender]) {
            revert UsageNotAuthorized(tokenId, msg.sender);
        }

        emit UsageRecorded(tokenId, payer, amount, agent.royaltyBps);
    }

    /// @inheritdoc IAgentNFT
    function authorizeUsage(uint256 tokenId, address user, bool allowed) external {
        address owner_ = _requireOwned(tokenId);
        if (owner_ != msg.sender) revert NotTokenOwner(tokenId, msg.sender);

        usageAuthorized[tokenId][user] = allowed;
        emit UsageAuthorizationChanged(tokenId, user, allowed);
    }

    // -------------------------------------------------------------------------
    // Admin
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentNFT
    function setOracle(address newOracle) external onlyOwner {
        if (newOracle == address(0)) revert InvalidOracle();
        address previous = oracle;
        oracle = newOracle;
        emit OracleChanged(previous, newOracle);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /// @inheritdoc IAgentNFT
    function getAgent(uint256 tokenId) external view returns (Agent memory) {
        _requireOwned(tokenId);
        return _agents[tokenId];
    }

    /// @notice EIP-712 domain separator. Recomputed if the chain id has
    ///         changed since deployment (forks, rare).
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        if (block.chainid == _CACHED_CHAIN_ID) return _DOMAIN_SEPARATOR;
        return _computeDomainSeparator(block.chainid);
    }

    /// @notice ERC-721 tokenURI. Returns a deterministic `data:` URI carrying
    ///         the metadata hash so off-chain indexers can join with 0G
    ///         Storage content without this contract hosting JSON.
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        bytes32 hash_ = _agents[tokenId].metadataHash;
        return string.concat(
            "data:application/json,%7B%22metadataHash%22%3A%22",
            Strings.toHexString(uint256(hash_), 32),
            "%22%7D"
        );
    }

    // -------------------------------------------------------------------------
    // Disabled ERC-721 transfer paths
    // -------------------------------------------------------------------------

    /// @dev Disable standard transfers. Use `transferWithReencryption`.
    function transferFrom(address, address, uint256) public pure override {
        revert UseTransferWithReencryption();
    }

    /// @dev Disable standard safe transfers. Use `transferWithReencryption`.
    function safeTransferFrom(address, address, uint256, bytes memory) public pure override {
        revert UseTransferWithReencryption();
    }

    /// @dev Disable approvals. The oracle gate is the only sanctioned path.
    function approve(address, uint256) public pure override {
        revert UseTransferWithReencryption();
    }

    /// @dev Disable operator approvals.
    function setApprovalForAll(address, bool) public pure override {
        revert UseTransferWithReencryption();
    }

    // -------------------------------------------------------------------------
    // Internal: oracle proof verification
    // -------------------------------------------------------------------------

    /// @dev Reconstructs the EIP-712 digest from the proof's bound fields,
    ///      compares each field against the call's expected values, and
    ///      ecrecovers the signature against the stored oracle address.
    function _verifyOracleProof(
        OracleProof memory proof,
        OracleAction expectedAction,
        uint256 expectedTokenId,
        address expectedFrom,
        address expectedTo,
        bytes32 expectedNewPointer,
        bytes32 expectedDataHash
    ) internal view {
        if (proof.action != expectedAction) revert WrongOracleAction(expectedAction, proof.action);
        if (proof.tokenId != expectedTokenId) revert TokenIdMismatch(expectedTokenId, proof.tokenId);
        if (proof.from != expectedFrom) revert FromMismatch(expectedFrom, proof.from);
        if (proof.to != expectedTo) revert ToMismatch(expectedTo, proof.to);
        if (proof.newPointer != expectedNewPointer) revert PointerMismatch(expectedNewPointer, proof.newPointer);
        if (proof.dataHash != expectedDataHash) revert DataHashMismatch(expectedDataHash, proof.dataHash);

        uint256 expectedNonce = tokenNonce[expectedTokenId];
        if (proof.nonce != expectedNonce) revert InvalidNonce(expectedNonce, proof.nonce);

        if (proof.signature.length != 65) revert MalformedSignature(proof.signature.length);

        bytes32 structHash = keccak256(
            abi.encode(
                OracleProofTypeHashes.ORACLE_PROOF_TYPEHASH,
                uint8(proof.action),
                proof.tokenId,
                proof.from,
                proof.to,
                proof.newPointer,
                proof.dataHash,
                proof.nonce
            )
        );

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));

        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, proof.signature);
        if (err != ECDSA.RecoverError.NoError || recovered != oracle) revert InvalidOracleProof();
    }

    function _computeDomainSeparator(uint256 chainId) internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                OracleProofTypeHashes.DOMAIN_TYPEHASH,
                OracleProofTypeHashes.DOMAIN_NAME_HASH,
                OracleProofTypeHashes.DOMAIN_VERSION_HASH,
                chainId,
                address(this)
            )
        );
    }
}
