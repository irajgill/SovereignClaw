# SovereignClaw Security Model

Current as of Phase 9 (v0.1). This is the reference document for:

- what SovereignClaw guarantees,
- what it explicitly does not,
- every primitive used and why,
- every assumption its guarantees depend on,
- every known gap that a production deployment must close.

It supersedes the earlier "Phase 3 draft" version. Paired with
[`docs/architecture.md`](./architecture.md) (layered stack + trust
model) and [`docs/benchmarks.md`](./benchmarks.md) (measured numbers).

> **Scope notice.** All code in this repo runs on 0G Galileo **testnet**
> against a self-hosted "dev oracle" (`apps/backend`). Mainnet deployment
> requires the changes listed in §8 "Production gap" to be closed. None
> of the guarantees below should be read as mainnet-safe until that is
> done.

---

## 1. Guarantees, at a glance

| Guarantee                                                                    | Mechanism                                           | Depends on                                   |
| ---------------------------------------------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| Memory plaintext is only readable by the owning wallet.                      | AES-256-GCM + KEK derived from an EIP-191 signature | Wallet key secrecy; signer determinism.      |
| Tampering with a stored envelope is detected, not silently read as valid.    | AES-GCM authentication tag + namespaced AAD         | GCM correctness; AAD coverage by callers.    |
| Transfer of an iNFT re-wraps the DEK to the new owner before it lands.       | On-chain oracle EIP-712 verification in `AgentNFT`  | Oracle key secrecy; EIP-712 constant parity. |
| Revoking an iNFT makes the on-chain DEK permanently inaccessible.            | `AgentNFT.revoke` zeroes `wrappedDEK` + sets flag   | Finality on 0G Chain; oracle signs revoke.   |
| Post-revocation, the oracle refuses all further re-encryption for the token. | In-memory (Phase 9: persistent) revocation registry | Oracle honest + alive; registry integrity.   |
| Each inference call’s TEE status is reported back to the caller.             | `verify_tee: true` flag + `tee_verified` in trace   | Router reports the flag honestly.            |
| A proof from one deploy on one chain cannot be replayed elsewhere.           | EIP-712 domain separator pins chainId + contract    | Domain constants match Solidity + Foundry.   |

Every row below §4 is structured as:
`Property → Mechanism → Failure modes → Mitigations`.

---

## 2. Trust boundaries

There are two, and only two, trust boundaries. Calling out more than
two usually means conflating failure modes with trust assumptions.

### 2.1 Boundary A — Wallet-derived encryption

All sovereign memory is AES-256-GCM encrypted **off-chain**, before
writing to 0G Storage, under a wrapped Data Encryption Key (DEK). The
Key Encryption Key (KEK) is deterministically derived from an EIP-191
wallet signature over a fixed namespaced message.

- The KEK never leaves the session (browser or server wallet).
- `AgentNFT.Agent.wrappedDEK` is up to 2048 bytes; anyone who does not
  hold the wallet cannot unwrap it.
- AAD for GCM is `(namespace, key)`; a ciphertext from one slot cannot
  be pasted into another without failing authentication.

Guarantees an attacker reading 0G Storage sees only ciphertext.
Does not guarantee forward secrecy: a wallet compromise decrypts all
historical ciphertext under that wallet. This is inherent to immutable
storage + stable keys.

### 2.2 Boundary B — The oracle

ERC-7857 transfer and revoke require an authorized proof. SovereignClaw
delegates that to a service we call **the oracle** (reference
implementation in `apps/backend`).

The oracle holds:

1. A long-lived secp256k1 keypair (the _oracle key_). `AgentNFT` verifies
   EIP-712 signatures from this address as a precondition to any
   transfer or revoke.
2. (Production-only) ECIES material to actually re-wrap the DEK.

The dev oracle is **centralized by design**. A production deployment
must run it inside a TEE, with persistent state, and with key rotation.
See §8.

---

## 3. Cryptographic primitives & why

Listed with the concrete choice, the one-line justification, and the
exact code reference.

| Primitive                   | Choice                                                                             | Justification                                                  | Code                                                                            |
| --------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------- | --- | --- | --- | ----- | --------------------------------------------------------------- | ----------------------------------------- |
| Envelope encryption         | AES-256-GCM, 96-bit random nonce                                                   | Authenticated; nonce space wide enough at our write rate.      | `packages/memory/src/crypto.ts`                                                 |
| AAD                         | `utf8("sc-v1:"                                                                     |                                                                | namespace                                                                       |     | ":" |     | key)` | Binds ciphertext to its slot; prevents cross-slot substitution. | `packages/memory/src/crypto.ts::buildAad` |
| Key wrapping (memory → DEK) | AES-GCM under KEK                                                                  | Same primitive, same tag; no extra code path.                  | `packages/memory/src/encrypted.ts`                                              |
| KEK derivation              | `keccak256(EIP-191 sig over namespaced msg)`                                       | Reproducible per wallet; no key store; standard EOA signature. | `packages/memory/src/crypto.ts::deriveKekFromSigner`                            |
| Oracle proofs               | EIP-712 typed-data over `{action, tokenId, from, to, newPointer, dataHash, nonce}` | Binds all fields; domain separator pins chain + contract.      | `packages/inft/src/eip712.ts`, `contracts/src/AgentNFT.sol::_verifyOracleProof` |
| Metadata hash               | `keccak256(packed metadata)`                                                       | Matches on-chain precompile; checked byte-equal in contract.   | `packages/inft/src/mint.ts::computeMetadataHash`                                |
| Transport to oracle         | HTTPS in production; HTTP on localhost                                             | Standard transport auth.                                       | `packages/inft/src/oracle-client.ts`                                            |
| Oracle API auth (optional)  | Bearer token (`ORACLE_AUTH_TOKEN`)                                                 | Cheap, per-deployment secret; see §8 for tightening.           | `apps/backend/src/auth.ts`                                                      |

### 3.1 EIP-712 constant integrity

Seven constants define the domain + struct hashing:
`ORACLE_PROOF_TYPEHASH`, `DOMAIN_TYPEHASH`, `DOMAIN_NAME_HASH`,
`DOMAIN_VERSION_HASH`, plus the three literal strings they hash from.
They exist in:

- Solidity — `contracts/src/AgentNFT.sol`
- TypeScript — `packages/inft/src/eip712.ts`
- Fixture — `deployments/eip712-typehashes.json` (emitted by Foundry)

A unit test (`packages/inft/test/eip712.test.ts`) asserts byte equality
across all three. Drift fails CI.

---

## 4. Threat model

We enumerate by attacker capability, not by attacker identity. For each
capability, we list the concrete outcomes, the mechanism that prevents
them, and the residual risk.

### 4.1 Attacker with read-only access to 0G Storage

- **Observe ciphertext:** allowed; no confidentiality claim for stored
  bytes beyond GCM + wallet-derived KEK.
- **Observe envelope shape (length, namespace, key):** allowed. We do
  not claim length-hiding or access-pattern privacy.
- **Read plaintext:** blocked by AES-GCM under KEK.

### 4.2 Attacker with write access to 0G Storage

- **Tamper with a ciphertext:** GCM authentication fails → `TamperingDetectedError`.
- **Delete a ciphertext:** possible in principle; resulting read returns
  the tombstone path (which the provider treats as "not found"). 0G
  Storage’s own durability properties govern realistic probability.
- **Replay an old ciphertext at a new key:** blocked by AAD
  (`namespace + key` binding).

### 4.3 Attacker who compromises the oracle key (but NOT the owner wallet)

- **Sign a transfer proof for an unrevoked token:** the contract
  requires BOTH the oracle's EIP-712 sig AND the owner's wallet sig on
  `_from`. The attacker cannot forge the owner sig without the wallet,
  so the transfer cannot be moved to them without the owner
  co-operating. Identical constraint for revokes.
- **DoS — sign bogus revocations:** possible. The contract accepts an
  oracle-signed revoke that carries the owner's EIP-191 revocation
  signature. Without the owner sig, the tx fails `owner == msg.sender`
  checks at the ERC721 level.
- **Censor transfers by refusing to sign:** possible. Mitigated by
  oracle-key rotation (`scripts/rotate-oracle.ts`) and by operational
  redundancy (production: TEE-attested key in a keygroup).

The **single highest-impact failure mode** remains: an oracle that is
both key-compromised AND colluding with a rogue "owner." In that case
the attacker can move not-yet-revoked tokens. Mitigation: TEE-attested
oracle in production, making key compromise itself uneconomic.

### 4.4 Attacker who compromises an owner wallet

Standard Web3 catastrophic case: they become that owner. Out of scope
for SovereignClaw to mitigate; standard wallet-hygiene and account-
abstraction escape hatches apply at the wallet layer.

### 4.5 Attacker at the 0G Compute Router

- **Return a wrong completion:** possible if they lie about `tee_verified`.
  Mitigation: `sealed0GInference` surfaces `teeVerified` on every call;
  callers can refuse `teeVerified !== true` (Phase 1 default for paid
  tier).
- **Leak the prompt/response:** possible unless the model runs in TEE
  and the response is transported over TLS. The testnet model is
  TEE-attested per the router dashboard; `verify_tee: true` asks the
  router to say so in the trace.

### 4.6 Malicious indexer

- **Return corrupt envelope bytes:** detected by GCM tag → tampering
  error.
- **Return a different envelope:** AAD check against the requested
  `(namespace, key)` fails.
- **Refuse service:** degrades to availability loss, not privacy loss.

### 4.7 Malicious MemoryRevocation registry writer

Cannot exist on-chain: `MemoryRevocation.agentNFT` is set in the
constructor, never changed, and only `agentNFT` can write. A compromise
here would require a contract bug; none known today, fuzzed in
`contracts/test/fuzz/`.

### 4.8 Malicious Studio user (self-served deploy abuse)

Once `STUDIO_SIGNER_ALLOWLIST` is configured (Phase 9, §8 closed item
L6), arbitrary users cannot trigger mints against the backend's minter
key. Before that flag is set, the backend **allows any client** to
submit a `POST /studio/deploy` — suitable for a personal dev box only.

---

## 5. Revocation: what it can and cannot do

Summarizing the roadmap §6.5 verbatim, with phase-accurate updates.

### 5.1 What revocation CANNOT do

- Delete the encrypted blob from 0G Storage. Storage is immutable.
- Recall a DEK that someone already extracted into their session. AES-GCM
  is symmetric; once the key has been seen, it has been seen.
- Prevent anyone who **already downloaded** the wrapped DEK from using
  it offline. The oracle's refusal helps future attempts, not past ones.

### 5.2 What revocation CAN do

- Zero the on-chain wrappedDEK and set `revoked = true` (irreversible).
- Make the oracle refuse future `/oracle/reencrypt` for the token (HTTP
  410 `OracleRevokedError`).
- Expose the `isRevoked(tokenId)` view for well-behaved readers.
- Emit the `Revoked(tokenId)` event for off-chain indexers and audit
  trails.

### 5.3 Measured latency

See [`docs/benchmarks.md` §4](./benchmarks.md). Headline: the
oracle-side refusal is **bounded by one HTTP round-trip (≪ 1 s)**; the
chain-durable revoke is **bounded by 0G Galileo block time (≈ 6–15 s)**.
Callers can pick which definition of "unreadable" matches their threat
model. After Phase 9 `onPhase` hook, both timings are observable from a
single `revokeMemory` call.

---

## 6. Defense in depth

If any single layer fails, what's still safe?

| Compromise                               | What remains safe                                                                                                                                                                     |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0G Storage operator turns hostile        | Ciphertext is unreadable without wallet KEK. AAD blocks cross-slot reuse.                                                                                                             |
| Single oracle key stolen                 | Cannot move tokens without owner sig; DoS possible. Mitigated by rotation + (production) TEE.                                                                                         |
| Owner wallet stolen                      | Standard Web3 catastrophic.                                                                                                                                                           |
| Compute provider returns wrong output    | `teeVerified` surfaced; caller can reject. Router has failover.                                                                                                                       |
| Indexer tampers                          | GCM tag fails.                                                                                                                                                                        |
| Indexer lies about acceptance of a write | SDK verifies Merkle root on readback.                                                                                                                                                 |
| `MemoryRevocation` write abused          | Only `AgentNFT.revoke` can write; writing requires owner sig + oracle sig; three checks must all pass.                                                                                |
| Studio deploy endpoint abused            | `STUDIO_SIGNER_ALLOWLIST` (Phase 9) rejects unknown signers; `esbuild` check catches malformed code before gas; server-side `generateCode` echo diff catches client source tampering. |

---

## 7. EIP-712 binding (full)

The signed struct is:

```
OracleProof {
  uint8  action;       // 0=Transfer, 1=Revoke
  uint256 tokenId;
  address from;
  address to;
  bytes32 newPointer;  // encrypted-pointer hash for the new owner
  bytes32 dataHash;    // keccak256 of the DEK the proof attests to
  uint256 nonce;       // monotonic, per-token
}
```

Domain separator fields:

- `name` = `"SovereignClaw AgentNFT"`
- `version` = `"1"`
- `chainId` = `16602` (Galileo)
- `verifyingContract` = AgentNFT address from `deployments/0g-testnet.json`

Each of the seven binding properties has a unit test:

| Property                | Unit test                                           |
| ----------------------- | --------------------------------------------------- |
| action-confusion replay | `packages/inft/test/eip712.test.ts::action*`        |
| cross-token replay      | `packages/inft/test/eip712.test.ts::tokenId*`       |
| cross-owner redirect    | `packages/inft/test/eip712.test.ts::from/to*`       |
| DEK substitution        | `packages/inft/test/eip712.test.ts::dataHash*`      |
| nonce replay            | `contracts/test/fuzz/AgentNFT.t.sol::replay*`       |
| cross-deploy replay     | domain-separator test in the same file              |
| TS/Sol constant drift   | `packages/inft/test/eip712.test.ts::matchesFixture` |

---

## 8. Production gap (what mainnet requires beyond this repo)

Known limitations of the testnet v0.1 that a production deployment
MUST close before taking mainnet traffic. L-prefixed for cross-reference.

| ID  | Limitation                                                                  | Required production action                                                                                        |
| --- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| L1  | Dev oracle runs a plain Node server with a single `.env`-loaded key.        | Run inside a TEE (Intel TDX or equivalent); attach attestations to every `/oracle/reencrypt` response.            |
| L2  | Oracle passes through the on-chain DEK bytes; no real ECIES re-wrap.        | Implement tamper-evident ECIES to the new owner's pubkey; publish a verification helper the new owner runs.       |
| L3  | Oracle revocation registry is process-local.                                | Persist (SQLite/Postgres + fsync); on boot, re-read on-chain `MemoryRevocation` + `AgentNFT.revoked` to rebuild.  |
| L4  | Oracle key rotation is manual (`scripts/rotate-oracle.ts`).                 | Scheduled rotation with quorum-signed transitions; keep `oracleHistory` in chain state or an off-chain audit log. |
| L5  | Oracle has no rate-limiting.                                                | Per-IP + per-wallet sliding window; auto-ban on abuse.                                                            |
| L6  | `STUDIO_CORS_ORIGINS` is the only request gate for `POST /studio/deploy`.   | `STUDIO_SIGNER_ALLOWLIST` + EIP-712 signature verification (Phase 9; wire-compatible).                            |
| L7  | `ORACLE_AUTH_TOKEN` is optional.                                            | Required in production; rotated alongside TLS certs.                                                              |
| L8  | Contracts are unverified on chainscan-galileo.                              | Upload flattened sources + constructor args; verify in the explorer UI or CLI.                                    |
| L9  | Off-chain oracle action log is not independently verifiable.                | Emit each oracle action as a signed append-only record; publish the signer pubkey; expose a read endpoint.        |
| L10 | No formal external security audit.                                          | Engage a qualified auditor for the contract set and the oracle service; re-run scope after TEE integration.       |
| L11 | `sealed0GInference` cannot verify TEE quotes itself; trusts `tee_verified`. | Implement direct-mode attestation verification (raw quote bytes); keep router trust as fallback only.             |
| L12 | Mainnet addresses and chainId not pinned (testnet only today).              | Add a production deployment JSON; add CI checks that disallow mainnet codepaths reading testnet env vars.         |

Closing each item is tracked in the dev-log under its originating phase.
Phases 0–9 have closed L6-adjacent plumbing (signature verification hook
in the backend, even if the signer allow-list remains a deployment-time
choice).

---

## 9. What's formally verified, what's tested, what isn't

| Layer                                               | Verification method                                                                                       |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Solidity revocation invariants                      | Foundry fuzz (`contracts/test/fuzz/`) + invariant tests; not formally verified.                           |
| EIP-712 constant parity (TS ↔ Solidity ↔ fixture) | Byte-equal unit test in `packages/inft/test/`.                                                            |
| Envelope encryption round-trip                      | Property tests (`packages/memory/test/crypto.test.ts`) — nonce uniqueness, AAD binding, tamper detection. |
| Oracle proof verification                           | Contract unit tests (`contracts/test/unit/`) against golden and mutated proofs.                           |
| Mesh bus ordering                                   | `packages/mesh/test/seq.test.ts` + integration tests against `InMemory` and `encrypted(OG_Log)`.          |
| Reflection loop                                     | Integration tests with a scripted critic; empirical measurements in `docs/benchmarks.md`.                 |
| Router TEE claim                                    | **Not verified** beyond the router's reported flag; see §4.5 + L11.                                       |
| Storage backend integrity                           | SDK-level Merkle-root verification on readback; we do not ship our own verifier.                          |

---

## 10. Responsible disclosure

SovereignClaw is a research-grade framework. If you find a
vulnerability — in the contracts, the `@sovereignclaw/*` packages, the
dev oracle, or ClawStudio — please **do not** open a public issue.

- **Email:** `claudee.helloagentic@gmail.com`
- **PGP:** to be published alongside v0.2; until then, TLS-to-email is
  considered acceptable for the threat profile of a testnet preview.
- **Scope:** anything in this repo + the deployed `AgentNFT` /
  `MemoryRevocation` contracts on 0G Galileo (`chainId 16602`).
- **Out of scope:** infrastructure we do not operate (0G Storage,
  0G Compute Router, 0G Chain validators). Report those upstream.

We commit to an acknowledgment within 72 hours and a public write-up
(credit opt-in) after the fix ships. There is no bug bounty for the
testnet phase; one will be announced with the first mainnet deployment.

---

## 11. Change log

| Version | Date               | Notes                                                                                                                                                                                                                              |
| ------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v0      | Phase 3            | Initial draft; trust boundaries + revocation semantics set.                                                                                                                                                                        |
| v0.1    | Phase 9 (this doc) | Audit-grade rewrite: formal threat model by attacker capability, primitives table with code refs, production-gap ledger (L1–L12), responsible-disclosure section. Supersedes the "Phase 3 draft" banner from the previous version. |

For rationale behind each change see the Phase 9 entry in
[`docs/dev-log.md`](./dev-log.md).
