# SovereignClaw Architecture

This document is the single-page answer to "how does SovereignClaw work"?
It covers the layered stack, the three critical data flows (build → run →
revoke), and the trust model — what each party must be trusted for, and
what each party is prevented from doing.

For measured numbers see [`docs/benchmarks.md`](./benchmarks.md).
For phase-by-phase design decisions see [`docs/dev-log.md`](./dev-log.md).

---

## 1. Layered stack

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ClawStudio (Next.js 14, Phase 7)           apps/studio via packages/studio│
│  - Drag-and-drop canvas (React Flow)         - Monaco live code preview    │
│  - Seed graphs + inspector forms             - Zustand client store        │
└─────────────────────────┬────────────────────────────────────────────────┘
                          │ POST /studio/deploy  (StudioGraph JSON)
┌─────────────────────────▼────────────────────────────────────────────────┐
│  Backend (Hono, apps/backend)                                            │
│  - /studio/deploy      - /studio/status       - /oracle/{pubkey,reencrypt,│
│  - esbuild code check  - LRU DeployStore        revoke,prove,healthz}    │
└─────────────────────────┬─────────────────────────┬───────────────────────┘
                          │                         │
                  writes manifest &        EIP-712 signs transfer / revoke
                  mints iNFTs               proofs (the oracle)
                          │                         │
┌─────────────────────────▼─────────────────────────▼───────────────────────┐
│  Agent packages                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐│
│  │ @sovereignclaw/  │  │ @sovereignclaw/  │  │ @sovereignclaw/          ││
│  │     core         │  │     mesh         │  │     reflection           ││
│  │ Agent, adapters, │  │ Bus, Mesh,       │  │ reflectOnOutput,         ││
│  │ sealed0GInference│  │ planExecuteCrit. │  │ rubrics, learnings       ││
│  └────────┬─────────┘  └────────┬─────────┘  └──────────┬───────────────┘│
│           └────────────────┬────┴───────────────────────┘                │
│                            ▼                                              │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ @sovereignclaw/memory — MemoryProvider, InMemory, OG_Log,          │  │
│  │ encrypted(), deriveKekFromSigner, typed errors                     │  │
│  └──────┬───────────────────────────────────┬─────────────────────────┘  │
│         │                                   │                              │
│  ┌──────▼───────────────┐           ┌──────▼──────────────┐                │
│  │ @sovereignclaw/inft  │           │   0G Storage Log    │                │
│  │ mint / transfer /    │           │   (envelopes +      │                │
│  │ revoke / oracle-client│          │    root hashes)     │                │
│  └──────┬───────────────┘           └─────────────────────┘                │
└─────────┼──────────────────────────────────────────────────────────────────┘
          │ on-chain calls
┌─────────▼────────────────────────────────────────────────────────────────┐
│  0G Chain (EVM, chainId 16602)                                           │
│  AgentNFT.sol — ERC-7857 iNFT with oracle-gated transfer + revoke        │
│  MemoryRevocation.sol — public registry of revoked tokens                │
└──────────────────────────────────────────────────────────────────────────┘
```

The whole graph is strictly layered: lower layers never import upper
layers. `@sovereignclaw/core` depends on `@sovereignclaw/memory` only;
`@sovereignclaw/mesh` and `@sovereignclaw/reflection` depend on `core` +
`memory` and nothing else; `@sovereignclaw/inft` depends on nothing from
the agent side. This keeps the build graph acyclic and lets you adopt
one layer at a time.

---

## 2. Three canonical data flows

### 2.1 Build — a user composes an agent graph

```
Studio UI (browser)
  └─► useStudioStore (Zustand)      — add/edit nodes, edges
        └─► validateGraph(graph)    — client-side invariants
              └─► generateCode(graph) — pure function → TS source
                    └─► Monaco preview + download / deploy
```

The output of `generateCode` is a deterministic, self-contained TypeScript
module that uses the same `@sovereignclaw/*` packages any hand-written
example uses. Same code, same runtime, same guarantees.

### 2.2 Run — a mesh produces a verifiable answer

```
planExecuteCritique({ mesh, planner, executors, critic, task })
  │
  ├─► planner.run(task)                              bus: PlanCreated
  │     └─ sealed0GInference → 0G Compute Router
  │          └─ response.trace.tee_verified asserted
  │
  ├─► executors[*].run(task + plan)                  bus: ExecutionComplete
  │     └─ sealed0GInference → 0G Compute Router
  │
  ├─► critic.run(task + plan + output, rubric)       bus: CritiqueCreated
  │     └─ parseCritique → { score, accept, reason }
  │
  ├─► if score < threshold: re-execute with suggestion, critique again (≤ maxRounds)
  │
  └─► return { finalOutput, rounds, score }          bus: TaskComplete
```

Every bus event is:

- **Sequenced** — monotonic `seq` within the mesh, durable on replay.
- **Addressed** — `fromAgent`, `meshId`, optional `parentSeq`.
- **Encrypted** — when the provider is wrapped with `encrypted(...)`,
  the payload is AES-256-GCM sealed to a KEK derived from the owner’s
  wallet signature. Indexer nodes see ciphertext.
- **Attested** — each inference reply carries `tee_verified: true` from
  the router. See `docs/benchmarks.md` for measured round-trip time.

### 2.3 Revoke — an owner durably kills an agent’s memory

```
owner clicks "revoke"
  │                                                       t = 0
  ├─► revokeMemory({ tokenId, owner, oracle, deployment })
  │     ├─ owner.signMessage("SovereignClaw revocation v1…")
  │     ├─ POST /oracle/revoke
  │     │    └─ oracle updates in-memory registry          t ≈ few 100 ms
  │     │       → any concurrent /oracle/reencrypt now 410s
  │     │    └─ returns EIP-712 proof of revocation
  │     └─ AgentNFT.revoke(tokenId, oldKeyHash, proof)
  │          └─ contract verifies oracle sig
  │          └─ zeroes wrappedDEK, sets revoked=true
  │          └─ emits MemoryRevocation.recordRevocation  t ≈ 6–15 s (block time)
  │
  └─► any future reader:
        /oracle/reencrypt → 410 OracleRevokedError (immediate)
        AgentNFT.ownerOf / getAgent → revoked=true, wrappedDEK=0x (durable)
        MemoryRevocation registry → tokenId present (public record)
```

The latency of the **oracle refusal** is bounded by one HTTP round-trip;
the latency of the **chain-durable** revocation is bounded by 0G Galileo
block time. See `docs/benchmarks.md` for measured numbers against the
live testnet.

---

## 3. Trust model

### 3.1 What the agent owner must trust

| Component           | Trusted for                                                                           | NOT trusted to                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Their own wallet    | Deriving the KEK; signing mints, transfers, revocations.                              | (this is the user — the root of the trust graph)                                                                                                  |
| The oracle          | Not issuing re-encrypt proofs without owner signatures; marking revocations promptly. | Minting to someone else (needs owner sig); revoking without owner sig (contract-enforced); holding plaintext (only sees ciphertext + wrappedDEK). |
| 0G Compute Router   | Returning `tee_verified: true` only when a TEE actually attested.                     | Silently mutating memory (memory lives on 0G Log, not the router).                                                                                |
| 0G Storage indexers | Storing/serving envelopes by root hash.                                               | Reading plaintext (ciphertext-only) or causally reordering events (seq-based replay detects gaps).                                                |
| 0G Chain validators | Honest consensus + EVM execution.                                                     | Forging oracle signatures (EIP-712 verified on-chain).                                                                                            |

### 3.2 What a compromised party can do

- **Compromised indexer:** serve corrupt envelopes → GCM tag mismatch →
  `TamperingDetectedError`. Worst case: availability loss, not privacy loss.
- **Compromised oracle:** refuse service (availability), OR, if it has
  the private key but not the owner's signature, it still cannot mint
  or transfer because `AgentNFT` requires the owner's signature in
  addition to the oracle's. It **can** issue a forged revocation proof —
  this is why the oracle key rotation procedure (`scripts/rotate-oracle.ts`)
  exists and why `apps/backend` runs the oracle behind its own auth token.
- **Compromised owner wallet:** game over for that agent’s memory —
  the attacker can decrypt, revoke, or transfer. The iNFT model doesn’t
  and shouldn’t rescue users from key loss.
- **Compromised router:** could lie about `tee_verified: true`.
  Short-term mitigation is cross-checking the router’s audit log; long-term
  mitigation is moving to direct-mode inference (already a stub in
  `sealed0GInference`; `DirectModeUnsupportedError` is exported so callers
  can detect it).

### 3.3 Cryptographic choices (one-line justifications)

- **AES-256-GCM for envelope encryption.** Authenticated; 96-bit nonces
  sampled per-write; AAD binds each envelope to its `(namespace, key, version)`
  so an attacker can’t paste a ciphertext from one slot into another.
- **KEK = keccak256(EIP-191 signature over a namespaced message).** No
  separate key store to secure or back up; same wallet + namespace
  always recovers the same KEK.
- **EIP-712 for oracle proofs.** Domain separator pins chainId and
  contract address so a proof from one deployment can’t be replayed on
  another.
- **Keccak256 for `metadataHash` and `oldKeyHash`.** Matches the on-chain
  precompile and the AgentNFT contract's expectations.

---

## 4. Boundaries & extension points

- **Swap the storage backend** — satisfy `MemoryProvider` (`get / set /
delete / list / flush / close`); `InMemory` and `OG_Log` both do.
- **Swap the inference adapter** — satisfy `InferenceAdapter.complete(…)`.
  `sealed0GInference` is one; a local-model adapter would be another.
- **Swap the reflection critic** — satisfy `ReflectionConfig.run(...)`.
  `reflectOnOutput(...)` is the default; hand-roll your own if you want
  a different grading policy.
- **Swap the orchestration pattern** — `planExecuteCritique` is a function
  over `{ mesh, planner, executors, critic }`. Write your own; nothing
  in `Mesh` is privileged.
- **Swap the oracle** — implement the `/oracle/{pubkey,reencrypt,revoke,
prove,healthz}` shape. `apps/backend` is a reference; a production
  deployment can sit behind a TEE or a threshold-signed keygroup.

---

## 5. Non-goals (for now)

- **Cross-process bus sharding.** The v0 Bus is single-writer inside one
  Mesh instance. Multi-writer / fan-in is tracked in `docs/dev-log.md`.
- **A pattern library.** Only `planExecuteCritique` ships. Debate and
  hierarchical patterns are intentionally held back so the surface area
  stays small until we have real users asking for them.
- **Browser-side EIP-712 signing in Studio.** The Phase 7 deploy
  pipeline uses a single backend minter key. Wallet-side signing is a
  planned Phase 9+ addition.
- **A resolver for agent identity.** iNFTs live on `AgentNFT`; who
  **owns** a given role ("researcher") is outside this stack. Use your
  own registry or a wallet-side naming convention.
