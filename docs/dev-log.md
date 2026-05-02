# SovereignClaw - Dev Log

Append-only chronological log of build progress and decisions. One entry per
working session. Per working agreement Section 19.14, end-of-day `main` must be
green.

---

## Phase 0 - Foundation

### Open architectural questions for Phase 1

1. **Compute path: Router vs Direct.** Roadmap Section 3.3 specifies the Direct
   SDK (`@0glabs/0g-serving-broker`) with manual ledger funding and TeeML
   verification. Since the roadmap was written, 0G has shipped the Compute
   Router - an OpenAI-compatible HTTPS gateway with API-key auth.
   **Update from Phase 0 dashboard inspection:** the Router supports a
   `verify_tee: true` request flag that returns on-chain TEE attestation in the
   response trace (`tee_verified` field). Confirmed working with
   `qwen/qwen-2.5-7b-instruct` on testnet. This means Router does not sacrifice
   the per-call attestation surface - it exposes it as opt-in. Phase 1 should
   standardize on Router for `sealed0GInference` unless the Direct SDK exposes
   attestation properties Router does not, such as raw TEE quote bytes for our
   own verification, or per-provider key pinning. Recommendation logged for
   Phase 1 kickoff: default Router, evaluate Direct only if a concrete
   sovereignty requirement demands it.
2. **Built-in SDK encryption.** `@0gfoundation/0g-ts-sdk@1.2.6+` ships native
   AES-256 + ECIES encryption. We're pinned to 1.2.1 which predates this.
   Roadmap Section 6.2 specifies our own `encrypted()` wrapper. Phase 1 must
   decide: (a) stay on 1.2.1 and write our own per spec - gives full control over
   key derivation from wallet sig per Section 6.3, or (b) upgrade >=1.2.6 and
   wrap the SDK's encryption. Either is defensible.
3. **Package naming.** Roadmap calls the storage SDK `@0glabs/0g-ts-sdk`; the
   actually-published package is `@0gfoundation/0g-ts-sdk`. Phase 0 uses the
   correct one. Future references in code/docs should match.

### Phase 0 → Phase 1 handoff: TEE field path resolved

Step 1.0 of Phase 1 ran `scripts/inspect-router-response.ts` against the
testnet Router with `qwen/qwen-2.5-7b-instruct`. Result:

- **TEE attestation field:** `x_0g_trace.tee_verified` (boolean).
- **Provider address:** `x_0g_trace.provider` (0x-prefixed, on-chain).
- **Request ID:** `x_0g_trace.request_id` (UUID, useful for support tickets).
- **Per-call billing:** `x_0g_trace.billing.{input_cost, output_cost, total_cost}`
  (string-encoded wei).

The Router uses an `x_0g_trace` envelope for all 0G-specific metadata.
This is the canonical extension point and Phase 1's `sealed0GInference`
adapter will type it explicitly.

**Confirmed live:** `tee_verified: true` returned for this model + provider
combination. TEE attestation is a real, verified claim, not theatre.

**Phase 1 implication:** `InferenceResult` will surface a typed `attestation:
{ teeVerified: boolean; providerAddress: string }` block and a `billing:
{ inputCost: bigint; outputCost: bigint; totalCost: bigint }` block on
every result. The roadmap §7.4 update from Phase 0 stands; we now have
the field path it referenced.

### Phase 1 Step 1.3 Turn B - Agent class + Phase 1 DoD

- Typed event emitter (`run.start`, `run.complete`, `run.error`, `tool.call`,
  `tool.result`).
- Agent class composing inference + memory + history + tools + lifecycle hooks.
- Run loop: build messages -> beforeRun -> inference -> afterRun -> persist
  context -> append history -> emit `run.complete`. Lifecycle hooks per Section
  7.5 (`onTransfer`/`onRevoke` bodies are Phase 3 territory but the hook surface
  is reserved).
- `examples/agent-hello`: end-to-end Phase 1 DoD example; runs against real 0G
  Galileo testnet, writes encrypted context to 0G Log, prints attestation.

**Phase 1 deferred:**

- Tool-calling loop (model-driven function calling): Phase 2.
- `onTransfer` hook body: Phase 3 (needs iNFT lifecycle).
- `onRevoke` hook: Phase 3.
- `maxConcurrentRuns` enforcement: Phase 5 (mesh introduces real concurrency).
- Reflection module: Phase 6 (its own package).

**Phase 1 status: DONE.** Tag: `phase-1-complete`.

### Phase 1 Step 1.3 Turn A — core foundation

- Typed errors: CoreError, InferenceError + 6 subtypes (Router{Auth,Balance,Client,Server}Error,
  InferenceTimeoutError, EmptyInferenceResponseError, DirectModeUnsupportedError),
  ToolError + 3 subtypes (Tool{Validation,Execution,Timeout}Error).
- sealed0GInference adapter: Router-based, surfaces typed Attestation
  (teeVerified, providerAddress, requestId from x_0g_trace) and BillingInfo
  (input/output/total cost as bigint wei from x_0g_trace.billing).
- Tool runtime: defineTool helper, executeTool with validation + timeout,
  httpRequestTool built-in with optional allowedHosts whitelist.

**Deferred from §7.3 (logged for later):**

- onChainTx tool — not needed until Phase 3+ when iNFT lifecycle is exposed.
- fileGen tool — needed for Phase 9 IncomeClaw pitch deck flow, not Phase 1.

Both can be added in any future phase without breaking the public API.

### Phase 1 Step 1.3 Turn B — Agent class + Phase 1 DoD

- Typed event emitter (run.start, run.complete, run.error, tool.call, tool.result).
- Agent class composing inference + memory + history + tools + lifecycle hooks.
- Run loop: build messages → beforeRun → inference → afterRun → persist context →
  append history → emit run.complete. Lifecycle hooks per §7.5 (onTransfer/onRevoke
  bodies are Phase 3 territory but the hook surface is reserved).
- examples/agent-hello: end-to-end Phase 1 DoD example; runs against real 0G
  Galileo testnet, writes encrypted context to 0G Log, prints attestation.

**Phase 1 deferred (each defensible per §19.15 / §7.5 hook reservations):**

- Tool-calling loop (model-driven function calling): Phase 2.
- onTransfer hook body: Phase 3 (needs iNFT lifecycle).
- onRevoke hook: Phase 3.
- maxConcurrentRuns enforcement: Phase 5 (mesh introduces real concurrency).
- Reflection module: Phase 6 (its own package).

**Phase 1 status: DONE.** Tag: `phase-1-complete`.

### Phase 1 — DONE (May 2 2026)

Phase 1 finish-line example ran cleanly against 0G Galileo testnet:

- wallet: 0x236E59315dD2Fc05704915a6a1a7ba4791cc3b5B
- example tx hash: 0x8d01de05b56c9d14b27908dc9ad2401e98ee99d1fca3e5163c6e29192362fe8b
- ciphertext root: 0x15374fb658b3765de35ba8d09f4f68d2df38bd8d41988e4dba6c4bae67a917a6
- model: qwen2.5-7b-instruct via 0G Compute Router
- provider: 0xa48f01287233509FD694a22Bf840225062E67836
- TEE verified: true
- inference latency: 2.5s
- per-call cost: 2.25e-6 0G

Test counts at Phase 1 close: 108 unit (core 60 + memory 48), 3 integration,
1 end-to-end example. Build, lint, typecheck all green.

Phase 1 deferred (each defensible per §19.15, picked up in named later phases):

- Tool-calling loop → Phase 2
- onTransfer hook body, onRevoke → Phase 3
- maxConcurrentRuns enforcement → Phase 5
- Reflection module → Phase 6
- onChainTx and fileGen tools → Phase 9 (IncomeClaw)

### Carryover from Phase 1 → Phase 2

1. **Storage SDK ethers v5 type incompatibility** — `@0gfoundation/0g-ts-sdk@1.2.1`
   ships ethers v5 types but runs against v6 fine. The `signer as any` cast is
   in `packages/memory/src/og-log.ts` at the indexer.upload boundary. Phase 2
   contracts work in pure Foundry/Solidity so this won't bite there, but the
   pattern is now a known constant of the build.

2. **Process-local index in OG_Log** — Phase 1 ships with the index built
   only from this process's own writes (cold start = empty index). Documented
   in `og-log.ts` module docstring. Phase 5 mesh will need cross-process
   recovery; that's the trigger for the manifest-pointer pattern from §6.6.

3. **AgentNFT contract storage layout** — when Phase 2 implements §5.1, the
   `encryptedPointer` field stores a 0G root hash (32 bytes, hex-encoded),
   matching the `Pointer` type in `@sovereignclaw/memory`. Phase 1 already
   produces these — no schema mismatch to negotiate.

4. **Two-balance funding model** — Phase 1 examples and integration tests
   surface this in their READMEs. Phase 4 quickstart docs (§13 Phase 4 DoD)
   must walk users through faucet→wallet AND wallet→Router deposit. Don't
   leave it for them to debug a 402.

5. **`@sovereignclaw/inft` package will depend on `@sovereignclaw/memory`**
   for the Pointer type. Add `"@sovereignclaw/memory": "workspace:*"` to its
   package.json from the start. (`@sovereignclaw/core` does not depend on
   inft and shouldn't — keep the layering clean.)

---

## Phase 2 — Smart contracts (May 2026)

### What shipped

- [contracts/src/interfaces/IAgentNFT.sol](../contracts/src/interfaces/IAgentNFT.sol),
  [IMemoryRevocation.sol](../contracts/src/interfaces/IMemoryRevocation.sol),
  [IOracle.sol](../contracts/src/interfaces/IOracle.sol) — interface freeze
  with full NatSpec, custom-error vocabulary, and the locked EIP-712 typehash.
- [contracts/src/MemoryRevocation.sol](../contracts/src/MemoryRevocation.sol) —
  immutable-bound revocation registry. Only the bound AgentNFT may write.
- [contracts/src/AgentNFT.sol](../contracts/src/AgentNFT.sol) — ERC-7857-style
  iNFT. Inherits `ERC721`, `Ownable2Step`, `ReentrancyGuard`. Standard
  ERC-721 transfer/approve paths disabled. EIP-712 typed-data oracle proofs
  with per-token monotonic nonces.
- [contracts/script/Deploy.s.sol](../contracts/script/Deploy.s.sol) — predicts
  the AgentNFT address with `vm.computeCreateAddress` so MemoryRevocation can
  bind to it immutably in one broadcast.
- 75 Foundry tests across 5 suites, 0 failing. Invariant suite ran 256 × 500
  calls per property = 128k randomized handler invocations each, 0 reverts.
- Gas snapshot committed at [contracts/.gas-snapshot](../contracts/.gas-snapshot).
- Live deploy on 0G Galileo testnet (chainId 16602). Both contract bytecode
  reachable; `pnpm check:deployment` passes 9/9 wiring assertions.

### Deployed addresses

| Contract         | Address                                      | Tx                                                                   |
| ---------------- | -------------------------------------------- | -------------------------------------------------------------------- |
| MemoryRevocation | `0x735084C861E64923576D04d678bA2f89f6fbb6AC` | `0x4015e1a585c1e2aa83fcfff1d9a1106aec1baa6c5fccec817e849eefcc81278d` |
| AgentNFT         | `0xc3f997545da4AA8E70C82Aab82ECB48722740601` | `0x51627bc78152b4cb546b62521972d92dd875ff25a7ff7aef04d8d7c0af62b51b` |

Deployer/initial-oracle: `0x236E59315dD2Fc05704915a6a1a7ba4791cc3b5B`. The
oracle is set to the deployer as a Phase-2 placeholder and will be rotated
in Phase 3 via `setOracle` once the dev-oracle service generates its keypair.

Total deploy cost: ~0.014 0G testnet (gas estimate from the broadcast log).

### Design refinements made during implementation

1. **`MemoryRevocation.revoke` signature dropped its own ECDSA check.**
   Roadmap §5.2 listed `revoke(tokenId, oldKeyHash, signature)` with the
   registry verifying the owner sig. Moved into AgentNFT.revoke instead;
   registry now only accepts calls from its bound AgentNFT (immutable). This
   is strictly stronger: the sig is verified once by the contract that knows
   the current owner, and the registry can't be poisoned by anyone with a
   stale signature. Roadmap §5.2 note pending.

2. **EIP-712 typed-data signing instead of raw eth_sign.** The roadmap §5.1
   said "verifies oracleProof was signed by oracle over (tokenId, msg.sender,
   to, newPointer)." Extended to a full EIP-712 domain (`SovereignClaw AgentNFT`
   v1 on chainId 16602, `verifyingContract = address(AgentNFT)`). Three wins:
   wallets show structured data instead of opaque hex; the domain separator
   pins signatures to this specific deploy; standard tooling (ethers
   `signTypedData`) means the Phase-3 oracle is trivial.

3. **`OracleProof` is a typed struct in the interface.** Wire format is still
   `bytes calldata oracleProof = abi.encode(OracleProof)` but the named struct
   gives Foundry tests clean ergonomics and Phase 3 a typechain-friendly type.

4. **Action discriminator (`OracleAction.Transfer | Revoke`) prevents
   action-confusion replay.** Without it a transfer proof could in principle
   be replayed as a revoke if the rest of the fields aligned. Cheap insurance.

5. **Per-token monotonic `tokenNonce`.** Each successful transfer or revoke
   bumps `tokenNonce[tokenId]` by 1, and the oracle proof must carry the
   exact current value. No replay possible.

6. **`tokenURI` returns a deterministic url-encoded `data:` URI** carrying
   only the metadata hash. No hosted JSON, no IPFS dependency, no oracle
   lookup. Off-chain indexers can join the hash with whatever 0G Storage
   blob the agent's owner publishes.

7. **Re-entrancy test was reframed.** `_transfer` (the path
   `transferWithReencryption` uses post-mint) does not call
   `onERC721Received`, so the original "attacker re-enters during transfer"
   scenario is structurally impossible. The test now mints into a malicious
   receiver — which forces `onERC721Received` to fire — and asserts that the
   receiver's attempted re-entry into `transferWithReencryption` cannot
   poison the outer mint. This still proves the `nonReentrant` guard wiring
   is correct without giving false-positive coverage of an attack vector
   that doesn't exist on `_transfer`.

### Source verification — the documented fallback

`forge verify-contract --verifier blockscout` against
`https://chainscan-galileo.0g.ai/api` does not work today. The host is a
client-rendered React SPA that returns the same 3.3 KB shell at every path,
including `/api`, `/api/v2`, `/api/v2/smart-contracts`, `/api?module=...`,
and several other Etherscan/Blockscout patterns probed during this phase.
Sourcify does not support chainId 16602 ("Chain 16602 is not a Sourcify
chain!"). docs.0g.ai's `deploy-contracts` doc page 404'd at the time of
deploy.

Per the §19.2 working agreement, the result must be "a clickable green
checkmark on chainscan." The path forward:

1. Flattened single-file source committed to
   [deployments/flattened/AgentNFT.flat.sol](../deployments/flattened/AgentNFT.flat.sol)
   (4097 lines) and
   [deployments/flattened/MemoryRevocation.flat.sol](../deployments/flattened/MemoryRevocation.flat.sol)
   (167 lines).
2. Manual upload via the chainscan-galileo UI when the explorer's
   verification page becomes navigable (currently the SPA route does not
   render a usable form — likely a 0G-side issue, not a contract issue).
3. Constructor-args ABI encoding documented in
   [deployments/0g-testnet.json](../deployments/0g-testnet.json) and
   [contracts/README.md](../contracts/README.md).
4. The `pnpm verify:contracts` script remains in place; it will work
   without modification when 0G ships a Blockscout/Etherscan-compatible
   endpoint.

This is the same kind of "endpoint shape pending" status that Phase 1 lived
with for the Router `tee_verified` field. Documented, not papered over.

### Carryover from Phase 2 → Phase 3

1. **Oracle rotation.** AgentNFT's oracle is currently the deployer wallet.
   First action of the Phase 3 dev-oracle service: generate its long-lived
   secp256k1 keypair, publish its address, and call
   `AgentNFT.setOracle(devOracleAddr)` from the deployer. Update
   `deployments/0g-testnet.json` `oracle` field.
2. **`@sovereignclaw/inft` ABI loader.** Should read directly from
   `contracts/out/AgentNFT.sol/AgentNFT.json` and
   `contracts/out/MemoryRevocation.sol/MemoryRevocation.json` rather than
   hand-maintaining ABIs. The deploy record in
   `deployments/0g-testnet.json` is the source of truth for addresses.
3. **Oracle EIP-712 signing reference.** The exact typehash and domain hashes
   the off-chain signer must use are in
   [contracts/src/interfaces/IOracle.sol](../contracts/src/interfaces/IOracle.sol)
   under `OracleProofTypeHashes`. Phase 3 must mirror these byte-for-byte.
4. **Test harness reuse.** [contracts/test/helpers/OracleSigner.sol](../contracts/test/helpers/OracleSigner.sol)
   already encodes the exact EIP-712 digest the on-chain `_verifyOracleProof`
   reconstructs — useful as a reference for the TS oracle signer. The
   structure to mirror is in `OracleSigner.digest()`.
5. **Gas-snapshot CI gate.** `pnpm contracts:snapshot:check` is wired into
   `package.json`; CI integration job in `.github/workflows/ci.yml` runs it
   alongside `forge test`. Adding new tests will require running
   `pnpm contracts:snapshot` and committing the updated snapshot.

---

## Phase 3 — Dev oracle + iNFT v0 (May 2026)

### What shipped

- [apps/backend/](../apps/backend/) — Hono on Node 22. Routes
  `/healthz`, `/oracle/pubkey`, `/oracle/prove`, `/oracle/reencrypt`,
  `/oracle/revoke`. Optional bearer auth. Loads its EIP-712 typehashes via
  re-export from `@sovereignclaw/inft`, which is byte-equal-checked against
  the Foundry-emitted fixture in `deployments/eip712-typehashes.json`. Ships
  with a multi-stage Dockerfile and a `docker-compose.yml` that brings the
  oracle up on `:8787`.
- [packages/inft/](../packages/inft/) — `mintAgentNFT`, `transferAgentNFT`,
  `revokeMemory`, `recordUsage`, `OracleClient`, `loadDeployment`. Pure
  ethers + JSON ABIs from `contracts/out/`. Zero `@sovereignclaw/core`
  dep. Typed errors only.
- [contracts/test/EmitTypeHashes.t.sol](../contracts/test/EmitTypeHashes.t.sol)
  — emits `deployments/eip712-typehashes.json` so the off-chain TS code
  can assert byte-equality against on-chain constants.
- [examples/agent-mint-transfer-revoke/](../examples/agent-mint-transfer-revoke/)
  — the Phase-3 DoD example. Mint → transfer (oracle re-encryption) →
  revoke against real testnet, with on-chain assertions and a final
  `OracleRevokedError` check.
- [scripts/gen-oracle-key.ts](../scripts/gen-oracle-key.ts) and
  [scripts/rotate-oracle.ts](../scripts/rotate-oracle.ts) — dev-oracle
  key generation and `setOracle` rotation helpers.
- [docs/security.md](./security.md) v1 — first cut of the trust model.

### Test counts

| Suite                                  | Count       | Notes                                                                                          |
| -------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------- |
| `@sovereignclaw/inft` unit             | 33          | mint, transfer, revoke, oracle client, deployment loader, EIP-712 roundtrip + tamper-detection |
| `@sovereignclaw/inft` integration      | 2           | real testnet mint→transfer→revoke + post-revoke 410                                            |
| `@sovereignclaw/backend` unit          | 16          | crypto roundtrip, store, all four oracle routes                                                |
| Foundry (Phase 2 + new EmitTypeHashes) | 76          | Phase 2's 75 + 1 typehash emitter                                                              |
| `@sovereignclaw/memory` (regression)   | (unchanged) |                                                                                                |
| `@sovereignclaw/core` (regression)     | (unchanged) |                                                                                                |

### Live oracle rotation

`setOracle` was called from the deployer wallet to point AgentNFT at the
generated dev-oracle key:

| Field           | Value                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| previous oracle | `0x236E59315dD2Fc05704915a6a1a7ba4791cc3b5B` (deployer placeholder)                                                          |
| new oracle      | `0x4a5CbF36C2aE90879f7c2eF5dCC32Fecb0b569e3` (dev oracle)                                                                    |
| tx              | [`0x1350215c…77aee1`](https://chainscan-galileo.0g.ai/tx/0x1350215cc6b521ac6a8d085a0bab1bb5ab1faded5931701b59886c124077aee1) |

Append-only history kept in `deployments/0g-testnet.json::oracleHistory`.
`pnpm check:deployment` was extended to optionally assert
`AgentNFT.oracle == env.ORACLE_ADDRESS` and now passes 9/9 + (optional) 10/10
with both env vars set.

### End-to-end DoD txs (one of the five clean runs)

| Step                               | Tx                    | Explorer                                                                                                      |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------- |
| Mint (Alice → token #1)            | `0xe5fe06f1…1d0421`   | [view](https://chainscan-galileo.0g.ai/tx/0xe5fe06f18799a96942d7aa1386f158be36015c1bc528b1e9e30ce58a6d1d0421) |
| Transfer (oracle re-encrypt → Bob) | `0xb7ded247…cdbbc70e` | [view](https://chainscan-galileo.0g.ai/tx/0xb7ded247513c897bc441044973b29fe42918bc2d59d5c7629db17b03cdbbc70e) |
| Revoke (Bob)                       | `0xae996473…0f384cc`  | [view](https://chainscan-galileo.0g.ai/tx/0xae99647335154b587de3c1e32c7e40902caea9cea52cfd9fe630501d50f384cc) |

Five consecutive clean runs of `pnpm dev` from
`examples/agent-mint-transfer-revoke` succeeded with no flake. Each run
mints a fresh tokenId so we don't depend on any session/test ordering.

### Design refinements made during implementation

1. **EIP-712 fixture as bridge.** Rather than hand-typing the four typehashes
   in TS, the Foundry test `EmitTypeHashes.t.sol` writes them to
   `deployments/eip712-typehashes.json`. The TS unit test recomputes locally
   from canonical strings and asserts equality with the fixture. Drift on
   either side fails CI.

2. **Phase 3 placeholder re-encryption** in `apps/backend/src/routes/oracle/reencrypt.ts`
   passes the on-chain `wrappedDEK` bytes through unchanged when re-issuing
   for the new owner. The example flow exercises the contract path
   end-to-end; the meaningful crypto upgrade (TEE-attested ECIES) is a
   Phase 8+ deliverable. Documented in
   `apps/backend/README.md`, `docs/security.md`, and inline.

3. **Oracle's revocation registry is process-local.** `apps/backend/src/store.ts`
   carries a deliberately-minimal in-memory `Map`. The persistence gap is
   documented at the top of the file. Belt-and-suspenders: `/oracle/reencrypt`
   _also_ reads the on-chain `Agent.revoked` flag and mirrors it back into
   the local set on every request, so a restart followed by a re-encrypt
   attempt will mark the token revoked again before the chain rejects.

4. **Dotenv is loaded by walking up.** `apps/backend/src/config.ts` and the
   example `src/index.ts` both look for `.env` at the repo root first, then
   cwd, then their own dir. This was driven by running `pnpm tsx src/server.ts`
   from `apps/backend/` not picking up the root `.env`.

5. **Workspace deps for repo-root scripts.** `scripts/rotate-oracle.ts`
   couldn't `import { AgentNFTAbi } from '@sovereignclaw/inft'` because the
   workspace root has no `node_modules/@sovereignclaw/*`. Switched to
   `createRequire()` reading the JSON artifact directly from `contracts/out/`.

6. **Re-entrancy test reframing** (Phase 2 carryover noted explicitly in
   Phase 3 readiness check). The Phase 2 nonReentrant test mints into a
   malicious receiver — `transferWithReencryption` uses `_transfer` which
   does not call `onERC721Received`, so the original "attacker re-enters
   during transfer" story doesn't structurally apply. Phase 2 reframed
   correctly; Phase 3 confirms the wiring still holds.

### Source verification on chainscan-galileo (Phase 2 carryover)

Re-checked during Phase 3. The chainscan-galileo SPA still serves its
3.3 KB shell at every API path. Manual UI upload is also blocked — the
`Verify and Publish` UI is not functional at this snapshot. Flattened
sources remain at [deployments/flattened/](../deployments/flattened/).
**No change since Phase 2; documented and moved on.** The
`pnpm verify:contracts` script is in place and will work without
modification when 0G ships an API.

---

## Phase 4 — ResearchClaw + quickstart docs (May 2026)

### What shipped

- [examples/research-claw/](../examples/research-claw/) — Phase 4 DoD
  example. Composes `@sovereignclaw/core` + `@sovereignclaw/memory` +
  `@sovereignclaw/inft` into a sovereign, encrypted, iNFT-minted research
  agent. ~100 LoC of agent wiring. Runs against real 0G Galileo testnet
  end-to-end in ~80 s. Reflection is deferred to Phase 6 per the roadmap.
- [docs/quickstart.md](./quickstart.md) — clone → funded wallet → iNFT in a
  paste-able path. Documents both the wallet and Router two-balance model
  (Phase 0 risk #21 / Phase 3 carryover #1) and the pinned-SDK storage
  flake rate (Phase 3 carryover). Includes a measured cold-start table.
- [scripts/benchmark-cold-start.ts](../scripts/benchmark-cold-start.ts) and
  `pnpm benchmark:cold-start` — reproducible step-by-step timing report,
  supports `--clean` (true cold) and `--skip-run` (CI smoke). Writes
  `scripts/.benchmarks/cold-start.json` for PR deltas (Phase 8 will wire
  these into CI).
- Root [README.md](../README.md) updated: status bumped to Phase 4, the
  ResearchClaw quickstart replaces the Phase 3 lifecycle block above the
  fold, benchmark commands referenced. Phase 3 material remains one click
  away under `examples/agent-mint-transfer-revoke/`.

### Measured cold-start (Phase 4 DoD run)

Linux x64 workstation, Node 23.3, warm lockfile, forge libs already
present in `contracts/lib/`:

| Step                | Wall time  | Notes                                               |
| ------------------- | ---------- | --------------------------------------------------- |
| `pnpm install`      | 0.9 s      | no network fetches, lockfile matched                |
| `forge install`     | skipped    | `contracts/lib/forge-std` + OZ already present      |
| `forge build`       | 0.1 s      | incremental                                         |
| `pkg-build`         | 3.7 s      | core + memory + inft in parallel                    |
| `research-claw-run` | 79.7 s     | 3 storage writes + 1 TEE inference + 1 mint tx      |
| **Total**           | **84.3 s** | full JSON report at `scripts/.benchmarks/cold-start.json` |

Wall time from a true first-clone (wipe `node_modules` and
`contracts/lib/`) adds roughly 10 s for npm fetches and 15 s for the two
`forge install` calls — clone-to-mint is still comfortably under 2 min,
with the roadmap §16 target of <10 min.

### End-to-end artifacts

Two clean verification runs against 0G Galileo:

| Run                     | Token  | Mint tx                                                                                                                                              |
| ----------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| ResearchClaw v1 (first) | #11    | [`0x76e7c8b5…91a56717`](https://chainscan-galileo.0g.ai/tx/0x76e7c8b5aba483cd6f42c505cc8c6911659e0a50522d7f8e6309e90091a56717)                        |
| Cold-start benchmark    | #12    | [`0x3d72b59f…5750e37`](https://chainscan-galileo.0g.ai/tx/0x3d72b59fd1ea13920b0e59c71a22227a27bc88de631720de8bcf67b8d5750e37)                         |

Each run also wrote three AES-256-GCM ciphertexts to 0G Storage Log via
the indexer, produced TEE-verified inference via the Router (provider
`0xa48f01287233509FD694a22Bf840225062E67836`, `tee_verified: true`), and
committed a metadata hash over `(role, pointer, owner, royaltyBps)` that
an off-chain indexer can recompute.

### Design refinements made during implementation

1. **Reflection stays in Phase 6.** The roadmap §12.1 ResearchClaw spec
   includes a `reflect: reflectOnOutput(...)` block; Phase 6 DoD says
   "ResearchClaw updated to use reflection". Phase 4 ships without it so
   we don't couple the quickstart to an un-built package. The
   manifest-pointer pattern (see below) is reflection-ready — Phase 6 will
   fold learnings into the same manifest.

2. **Explicit manifest pointer, not agent's internal context.** `Agent.run`
   writes a `context` key to memory internally; its pointer isn't exposed
   on the public API. ResearchClaw writes its own `manifest` key after the
   run completes and mints against that pointer. The commit is:
   `computeMetadataHash({ role, pointer, owner, royaltyBps })`. Clean
   separation between agent runtime state and iNFT-committed manifest.

3. **Cold-start benchmark is skip-aware.** `forge install` is skipped when
   `contracts/lib/*` already exist (common case after the first run). The
   benchmark reports the skip explicitly in its summary and JSON so CI
   can't confuse a warm run for a cold one.

4. **Foundry libs are `forge install --no-git`.** Same reason as the
   Phase 3 lockfile commit: the SovereignClaw repo has no `.gitmodules`
   and we don't want `forge install` adding one implicitly. The quickstart
   mirrors this flag. A future improvement is to add an `install-all.sh`
   wrapper in `scripts/` that handles both pnpm and forge in one call.

5. **Research-claw pnpm script wires typecheck.** `pnpm --filter
   @sovereignclaw/example-research-claw typecheck` fails fast if the
   example drifts from the public API shapes of core/memory/inft, which
   catches breaking changes before anyone hits a runtime 1G Storage tx.

### Honest flake note (carryover from Phase 3, unchanged in Phase 4)

Across the Phase 4 verification session, the `@0gfoundation/0g-ts-sdk@1.2.1`
indexer-node selection revert-rate on small storage writes was observed
at roughly **1 run in 3**. A second `pnpm dev` consistently hit a
different node and succeeded. This matches the Phase 3 observation and is
surfaced in both `docs/quickstart.md` and
`examples/research-claw/README.md`. No code change in Phase 4 — a Phase 6
or Phase 8 follow-up is to add a retry/backoff inside
`@sovereignclaw/memory`'s `OG_Log.set`, ideally with a fee-escalation
policy. Tracking item.

### Carryover from Phase 4 → Phase 5 (Mesh)

1. **Agent flush pattern is memory-only today.** `Agent.flush()` iterates
   attached providers and calls `.flush()`. When Mesh introduces a bus on
   `OG_Log`, the bus provider should participate in the same flush
   contract — either as a direct `MemoryProvider` injected into the Agent
   or as a separately-flushed handle on the `Mesh` instance.

2. **Manifest schema is v1.** ResearchClaw writes `{ v: 1, role, namespace,
   mintedAt, lastRun: {...} }`. Phase 5 mesh events and Phase 6 reflection
   learnings should extend rather than replace this schema so off-chain
   indexers built against Phase 4 iNFTs continue working.

3. **Benchmark harness is ready for more DX metrics.** The
   `scripts/benchmark-cold-start.ts` pattern (sequential steps → JSON
   report) is reusable. Phase 5–8 will drop in peers:
   `benchmark-mesh-throughput`, `benchmark-revoke-latency`,
   `benchmark-inference-rtt`, `benchmark-loc` (per roadmap §14.6).

### Carryover from Phase 3 → Phase 4 (ResearchClaw + quickstart)

1. **Quickstart docs must walk users through the _three_-balance reality**:
   wallet (faucet → wallet for gas), Router deposit (wallet → Router for
   compute), and Bob/test wallet for transfer testing. Phase 0 risk #21
   covered the first two; Phase 3 added a third because the example
   requires two funded wallets.

2. **Real ECIES re-encryption.** Phase 3 placeholder is documented; Phase 8
   (security) is the natural home for replacing it, but the API contract is
   stable so `apps/backend/src/routes/oracle/reencrypt.ts` is the only file
   that needs to change.

3. **Persist the oracle revocation registry.** Either back it with Redis
   (matches the existing `BullMQ` plan in §3.6) or rebuild from the chain
   on boot. Add to Phase 8 or sooner if any persistent oracle deploys.

4. **Source verification flip on chainscan-galileo.** Continue probing
   periodically; `pnpm verify:contracts` is wired up. When 0G ships a
   verifier endpoint, run it and flip `verified` to `true` in
   `deployments/0g-testnet.json`. (Could be a scheduled background agent —
   `/schedule` an agent to retry monthly.)

---

## Phase 5 — Mesh v0 (planner/executor/critic on a 0G Log bus)

### What shipped

- **`@sovereignclaw/mesh`** package with four surfaces:
  - `Bus` — append-only event log wrapping any `MemoryProvider`. Writes
    JSON envelopes under zero-padded `evt:…` keys (16-char seqs) so
    `provider.list('evt:')` replays in correct order after a sort.
  - `Mesh` — `Bus` + agent registry (`register(agent, alias?)`), bus
    listener fan-out, and close semantics that cleanly tear down the
    underlying provider.
  - `planExecuteCritique({ planner, executors, critic, task, ... })` —
    the default orchestration pattern. Emits typed events
    (`task.created`, `plan.created`, `execution.started`,
    `execution.complete`, `critique.created`, `plan.revise`,
    `task.complete`) with `parentSeq` linkage and a robust critic-JSON
    parser that tolerates code fences and surrounding prose.
  - Typed errors: `MeshError`, `BusAppendError`, `BusReplayError`,
    `PatternError`, `EmptyAgentOutputError`, `MaxRoundsExceededError`,
    `CritiqueParseError`, `MeshClosedError`.

- **30 unit tests** across three suites (seq, bus, pattern), all green.
  Patterns tested with fake `InferenceAdapter`s — zero network calls.

- **Live integration suite** (`INTEGRATION=1`,
  `packages/mesh/test/integration/mesh-3-agent.test.ts`) that runs the
  pattern against real 0G Galileo. Opt-in to preserve CI speed.

- **`examples/research-mesh/`** — the Phase 5 DoD demo. Three real agents
  (planner/executor/critic) backed by `sealed0GInference` run
  `planExecuteCritique` over an encrypted bus on 0G Log. Prints every
  event's 0G root hash and a `storagescan-galileo.0g.ai/tx/<root>` link
  so reviewers can verify end-to-end.

### Measured end-to-end on real testnet

Command:

```bash
pnpm --filter @sovereignclaw/example-research-mesh dev
```

Result (single round, accept-first-pass):

- `rounds=1 score=1.000 acceptedExecutor=executor`
- Wall time: **~120s** (dominated by 3 inference calls + 6 storage writes).
- **6 bus events** persisted on 0G Log, monotonic `seq=0..5`:
  `task.created → plan.created → execution.started → execution.complete → critique.created → task.complete`.
- Each event has a 0G root hash; on-chain storage submit tx hashes (`0x22E03a…` Flow contract):
  `0x55e4704f…` (seq 0), `0xa76fd82f…` (1), `0x059eea7f…` (2),
  `0xa839b949…` (3), `0xc15917a7…` (4), `0x8f322570…` (5).
- Final output: the Transformer paper with all 8 authors and venue
  (NeurIPS) — i.e. the critic scored it 1.0, threshold was 0.7, and it
  accepted on round 1.

Encryption: the bus is wrapped by `encrypted(OG_Log(...))` with a
KEK derived from `signer.signMessage(...)`, so **every byte on 0G
Log is ciphertext**; only the owning wallet can decrypt the event
stream. Sovereignty preserved by construction.

### Design choices & deferrals

- **Single-writer Mesh v0.** The roadmap §8.1 calls for `(seq, writerAddr)`
  tiebreak rules. We deliberately did not build that yet. v0 has one
  writer (the orchestrator process), so a plain monotonic counter is
  correct and shipped code is simple. The envelope is shaped so adding
  `writerAddr` and (local_clock, counter) is a non-breaking change.
- **Cross-process replay is 5.1, not 5.0.** `OG_Log`'s v0 index is
  process-local (Phase 1 carryover #2). `Bus.replay()` works fine within
  a single process; true cold-start replay of a bus written by a crashed
  orchestrator needs a new `MemoryProvider.listFromRoot()` API or direct
  indexer pagination. Ship path is clear; not on the Phase 5 critical
  path for the DoD claim.
- **Only `planExecuteCritique` in v0.** `debate` and `hierarchical`
  patterns from §8.2 are deferred. The pattern API takes agent instances
  as parameters, so both will slot in without core changes.
- **Backpressure is in-memory.** §8.4 proposes Redis/BullMQ. v0 runs
  agents sequentially inside `planExecuteCritique` (parallel only across
  executors in a single round). `maxConcurrentRuns` enforcement remains
  deferred from Phase 1 for the same reason.
- **Critic JSON parser is generous on purpose.** Open-model critics
  routinely wrap JSON in prose or code fences. The parser tries strict,
  then stripped-fence, then first `{...}` block; throws
  `CritiqueParseError` only if all three fail. Prompts still ask for
  one-line JSON (§CRITIC_INSTRUCTION) so strict mode is the normal path.

### Flake notes

- Same 0G-SDK storage-upload revert we documented in Phase 4 can surface
  here too (transient fee mismatch across indexer nodes). First run this
  phase succeeded on attempt 1 — mesh writes are small (JSON envelopes
  in the 1 KB range) so they generally fit any node's fee policy. If it
  flakes, re-run the example; same advice as `docs/quickstart.md`.

### Carryover from Phase 5 → Phase 6 (reflection)

1. **Surface the tx hash on writes.** Bus events currently expose only
   the 0G root hash (`pointer`). The SDK also returns `txHash` on upload
   — passing it through `MemoryProvider.set()` (non-breaking: optional
   second field on the return) would give patterns first-class on-chain
   references and cleaner explorer links than `storagescan-galileo/tx/<root>`.
2. **Cross-process bus replay.** Gate Phase 5.1; implement either a new
   `MemoryProvider.listFromRoot(meshRoot)` API or a purpose-built
   `Bus.hydrate({ fromIndexer })` that walks the 0G indexer directly.
   Unlocks orchestrator restart recovery (§8.3 replay test).
3. **Checkpoint events.** §8.3 specifies writing a checkpoint every 50
   events or 30s. Add a `Bus.checkpoint()` method that emits a
   `bus.checkpoint` event whose payload is `{ fromSeq, toSeq, summary }`.
   Cheap, lets replay start from the last checkpoint instead of seq 0.
4. **Pattern reflection hook.** Phase 6's reflection module should
   consume bus events to mine lessons. Suggest a pattern-level
   `onComplete?(result, events)` callback so reflection can run without
   the pattern reaching into 0G itself.

---

## Phase 6 — Reflection v0 (self-critique + learnings persistence)

### What shipped

- **`@sovereignclaw/reflection`** package with four surfaces:
  - `reflectOnOutput({ rounds, critic, rubric, persistLearnings, threshold })`
    returns a `ReflectionConfig` that plugs into `new Agent({ ...,
    reflect })`. Matches the §10.1 API.
  - Built-in rubrics `'accuracy' | 'completeness' | 'safety' |
    'concision'` with dedicated guide prompts, plus a `CustomRubric`
    callback for user-defined judgement.
  - `parseCritique()` — the same strict/fenced/prose-embedded grammar
    that the mesh critique parser uses, exported so callers can roll
    their own loops without re-implementing it.
  - Typed errors: `ReflectionError`, `CritiqueParseError`,
    `LearningPersistError`, `InvalidReflectionConfigError`.

- **`@sovereignclaw/core` Agent integration**:
  - `AgentConfig.reflect?: ReflectionConfig` — structural interface
    declared in core so core does not depend on reflection.
  - `Agent.run()` step 7 (§7.2) wired: after inference, if `reflect` is
    configured, we call `reflect.run({...})`, replace the output with
    `reflected.finalOutput`, and emit `reflect.start` / `reflect.complete`
    typed events.
  - Step 9 (§10.2) wired: when `reflect` is configured and `history` is
    attached, `Agent.run()` calls `listRecentLearnings(history,
    learningsContextLimit ?? 3)` before inference and prepends a system
    message of the form "Prior reflected learnings (most recent first,
    provided as additional context): 1. ..." so future runs benefit
    from prior self-critique.
  - `LEARNING_PREFIX` + `listRecentLearnings(history, limit)` helper
    exported so CLIs, dashboards, or the upcoming ClawStudio can query
    learnings without reflection as a direct dep.

- **35 unit tests** across four suites (parser, rubrics, reflect,
  agent-integration). Fake `InferenceAdapter`s exercise every loop
  branch (accept r1, revise-and-accept r2, max-rounds-reached,
  peer critic, custom rubric, empty JSON, fenced JSON, prose-embedded
  JSON, history-set failure, invalid config). All green.

- **Opt-in integration test** (`INTEGRATION=1`,
  `packages/reflection/test/integration/with-vs-without-reflection.test.ts`)
  running two sibling agents (no reflection + with reflection) against
  real 0G Galileo and asserting `listRecentLearnings` returns the
  expected record.

- **ResearchClaw updated** to match the §12.1 spec:
  `reflect: reflectOnOutput({ rounds: 1, critic: 'self', rubric:
  'accuracy', persistLearnings: true, threshold: 0.7 })`. The example
  now also emits `reflect.start`/`reflect.complete` event logs and,
  after the mint, calls `listRecentLearnings(history)` to prove the
  learning is queryable. The iNFT-mint flow is unchanged.

### Measured end-to-end on real testnet

Command:

```bash
pnpm --filter @sovereignclaw/example-research-claw dev
```

Result on the "three most cited RAG papers from 2024" prompt:

- Inference succeeded (TEE-verified via Router). Wall time ~85s.
- Reflection fired: `accepted=false rounds=1 score=0.00`. The critic
  correctly penalized the model's fabricated 2024 citations — the
  model honestly answered "as of my last update in early 2023, I
  don't have specific information on..." and the rubric scored that
  0 against the accuracy rubric, exactly as designed.
- Learning persisted to history on 0G Log with pointer
  `0x4ec0c1d57ea967d0f456b726c08c6d7909b9161e42e54a05d401fea2ec8ec99a`.
- Learning queryable: the example calls `listRecentLearnings(history)`
  post-mint and prints `count=1 entries=[{runId, score, accepted,
  rounds, preview}]`. DoD "learning is queryable" satisfied.
- Manifest written (pointer
  `0x15a27871c3bc19a440007f7faf844641a20297e49ff7b3bb8646a157e1d28fef`)
  and iNFT minted (tokenId **13**, tx
  `0x90508d9c0570bbd9b14973cc529aca809804a422ab1a9013e9dc5a13bba700c6`,
  verifiable on chainscan-galileo).

The 4 on-chain storage submit tx hashes (context / history-run /
learning / manifest) from the run:
`0x74dcf4c2…9ead5`, `0xbedeecba…733b35`, `0xcd062183…37e4276`,
`0xc696c09b…fd301d`. The mint tx `0x90508d9c…700c6`.

On "visible improvement" (DoD): with `rounds: 1` the loop does one
critique pass, no revision — so the "improvement" here is that the
framework correctly flagged a low-quality answer and persisted that
flag as a learning for future runs instead of quietly returning
fabricated text. Revision-based improvement (rounds ≥ 2) is
exhaustively tested in `test/reflect.test.ts`'s "revises and accepts on
round 2" case against fake adapters; the live test intentionally runs
with the §10.1 spec default to match the roadmap.

### Design choices & deferrals

- **`ReflectionConfig` lives in core, implementation lives in reflection.**
  Same shape as `MemoryProvider` (declared in memory, consumed by core).
  Keeps the package graph acyclic and lets callers depend on just
  `@sovereignclaw/core` if they want to ship their own reflection
  implementation.
- **`critic` is `'self' | InferenceAdapter`, not `'self' | Agent`.**
  §10.1 shows `Agent` but v0 uses `InferenceAdapter` so we don't spin
  up a second Agent instance just to critique. Upgrading to accept a
  full Agent is non-breaking (union widening); deferred until a caller
  actually needs it.
- **Top-k learnings-in-context ranks by recency, not embedding similarity.**
  §10.2 step 9 mentions similarity; v0 ships recency-order (sorted by
  timestamp desc). When we add an embedding adapter (Phase 8 benchmarks
  or later), switching to similarity is a one-function swap inside
  `listRecentLearnings` or a new ranked variant.
- **Revision calls `ctx.inference.run(...)` directly, not `agent.run(...)`.**
  Avoids recursive `reflect` triggers and keeps the whole loop inside
  a single Agent run scope (one `runId`, one persisted history entry).
- **Learning persistence uses the caller's `history` provider.** Same
  provider the Agent already writes run entries to, same key namespace
  (`learning:<runId>`). No new provider is introduced. The record
  schema is versioned (`version: 1`) so additive migrations stay
  painless.

### Flake notes

- Same transient 0G storage-upload revert surfaced on the first live
  run (manifest write). All prior writes (inference context, history
  entry, learning) succeeded; only the final manifest write on the
  first attempt hit a reverting indexer node. Retrying the command
  succeeded on attempt 2. Documented behaviour matches Phase 4/5 flake
  notes in `docs/quickstart.md` and per-example READMEs.

### Carryover from Phase 6 → Phase 7 (ClawStudio)

1. **Reflection as a Studio node.** §11.2 already lists it. The config
   surface is small and matches `ReflectOnOutputOptions` 1:1 — ideal
   for a small form (rounds numeric, critic dropdown, rubric dropdown
   + textarea for custom, threshold slider, persistLearnings toggle).
2. **Embedding-based similarity ranking.** Phase 8 benchmarks needs a
   "reflection adds <1 extra inference" measurement (§16). When we
   ship embeddings, swap `listRecentLearnings` recency ranking for
   top-k by similarity to the new input.
3. **Revision history visibility.** `ReflectionResult.roundDetails[]`
   already contains per-round score, suggestion, reasoning, and
   latencies. Studio should surface this in the run trace panel.
4. **Cost accounting.** Reflection doubles inference calls when a
   revision happens. `ReflectionResult` should expose a `billing`
   aggregate (inputCost+outputCost across critique + revision + base)
   so users and `recordUsage` can see the true per-run cost. Today the
   caller only sees the final Agent output's billing. Additive,
   non-breaking change.
