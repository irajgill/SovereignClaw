# SovereignClaw

Sovereign-memory, multi-agent, iNFT-native agent framework for 0G.

> **Status:** Phase 9 — polish + audit hardening shipped. `revokeMemory`
> now reports per-phase timings via an `onPhase` hook; the new
> oracle-side refuse number is **1.5 s** (vs the <5 s target). Studio
> deploys now accept EIP-712 wallet signatures verified against
> `STUDIO_SIGNER_ALLOWLIST` (open-mode fallback for local dev), and the
> backend re-runs the canonical codegen on every deploy to reject
> tampered client source before gas. Reflection nodes support custom
> rubrics via the Inspector. `docs/security.md` has been rewritten
> audit-grade (L1–L12 production-gap ledger, attacker-capability threat
> model, responsible-disclosure section). CI now gates on the LoC
> benchmark. See [docs/dev-log.md](docs/dev-log.md) for the full Phase 9
> entry and [docs/benchmarks.md](docs/benchmarks.md) for fresh numbers.
>
> **Phase 10 (minimal):** packages published to npm at v0.1.0; dev oracle
> live on Railway. See Production Endpoints below.

## Production Endpoints

| Resource                  | Value                                                                   |
| ------------------------- | ----------------------------------------------------------------------- |
| npm packages              | `@sovereignclaw/{core,memory,mesh,inft,reflection}` v0.1.0              |
| Dev oracle (production)   | `https://oracle-production-5db4.up.railway.app` (Bearer-token required) |
| AgentNFT contract         | `0xc3f997545da4AA8E70C82Aab82ECB48722740601`                            |
| MemoryRevocation contract | `0x735084C861E64923576D04d678bA2f89f6fbb6AC`                            |
| Network                   | 0G Galileo Testnet (chainId 16602)                                      |

**Quick install:**

```bash
pnpm add @sovereignclaw/core @sovereignclaw/memory @sovereignclaw/inft ethers
```

**Use the production oracle:**

```typescript
import { OracleClient } from '@sovereignclaw/inft';

const oracle = new OracleClient({
  url: 'https://oracle-production-5db4.up.railway.app',
  authToken: process.env.ORACLE_AUTH_TOKEN, // request from operator
});
```

The dev oracle requires Bearer-token auth on every request. Ask the operator
for a token if you need oracle access for a downstream project. The full
production deployment record — Railway service ID, smoke-test tx hashes,
post-revoke assertions — lives in
[`deployments/oracle-prod.json`](deployments/oracle-prod.json).

## Deployed addresses (0G Galileo Testnet, chainId `16602`)

| Contract         | Address                                      | Explorer                                                                                        |
| ---------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| AgentNFT         | `0xc3f997545da4AA8E70C82Aab82ECB48722740601` | [chainscan](https://chainscan-galileo.0g.ai/address/0xc3f997545da4AA8E70C82Aab82ECB48722740601) |
| MemoryRevocation | `0x735084C861E64923576D04d678bA2f89f6fbb6AC` | [chainscan](https://chainscan-galileo.0g.ai/address/0x735084C861E64923576D04d678bA2f89f6fbb6AC) |

Source verification on chainscan-galileo is currently manual via the explorer
UI — flattened single-file sources are committed under
[deployments/flattened/](deployments/flattened/) for upload. See
[contracts/README.md](contracts/README.md) for instructions and the constructor-
args ABI encoding. The full deployment record (tx hashes, deployer, oracle,
constructor args, oracle rotation history) lives in
[deployments/0g-testnet.json](deployments/0g-testnet.json).

Run `pnpm check:deployment` at any time to assert that the live contract state
on 0G matches the committed record (binding, oracle, owner, name, symbol, and
the `DESTROYED_SENTINEL` constant). With `ORACLE_ADDRESS` set in env, also
asserts the live `AgentNFT.oracle()` matches your local oracle key.

## What's built so far

| Layer                                                                                                                                 | Status                                                                                |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| v0.1.0 npm release + production oracle (Phase 10, minimal)                                                                            | Five `@sovereignclaw/*` packages on npm; dev oracle on Railway with bearer-token auth |
| `@sovereignclaw/memory` (Phase 1)                                                                                                     | Sovereign memory primitives — encrypted, revocable, 0G-Storage-backed                 |
| `@sovereignclaw/core` (Phase 1)                                                                                                       | Agent runtime, `sealed0GInference` adapter                                            |
| `AgentNFT.sol`, `MemoryRevocation.sol` (Phase 2)                                                                                      | ERC-7857 iNFT lifecycle, deployed and pinned                                          |
| [`@sovereignclaw/inft`](packages/inft/) (Phase 3)                                                                                     | Mint / transfer-with-reencryption / revoke / recordUsage helpers                      |
| [`@sovereignclaw/backend` dev oracle](apps/backend/) (Phase 3)                                                                        | Hono service signing EIP-712 oracle proofs                                            |
| [`examples/agent-mint-transfer-revoke`](examples/agent-mint-transfer-revoke/) (Phase 3)                                               | DoD example: full lifecycle on real testnet                                           |
| [`examples/research-claw`](examples/research-claw/) (Phase 4)                                                                         | DoD example: sovereign agent + TEE inference + encrypted mint, ~80 LoC                |
| [`docs/quickstart.md`](docs/quickstart.md) + `pnpm benchmark:cold-start` (Phase 4)                                                    | Clone-to-iNFT paste path, reproducible ~85s cold-start benchmark                      |
| [`@sovereignclaw/mesh`](packages/mesh/) (Phase 5)                                                                                     | Bus over 0G Log, `planExecuteCritique`, typed events, 30 unit tests                   |
| [`examples/research-mesh`](examples/research-mesh/) (Phase 5)                                                                         | DoD example: planner + executor + critic, 6 encrypted bus events on-log               |
| [`@sovereignclaw/reflection`](packages/reflection/) (Phase 6)                                                                         | `reflectOnOutput()`, 4 built-in rubrics, learnings persistence, 35 unit tests         |
| `reflect: reflectOnOutput({...})` in ResearchClaw (Phase 6)                                                                           | Self-critique on every run; `learning:<runId>` queryable via `listRecentLearnings`    |
| [`@sovereignclaw/studio`](packages/studio/) (Phase 7)                                                                                 | Next.js drag-and-drop builder, 6 node types, pure codegen, Monaco preview             |
| `/studio/deploy` + `/studio/status/:id` in backend (Phase 7)                                                                          | esbuild-validates generated code, writes manifest to 0G, mints one iNFT per agent     |
| `pnpm smoke:studio` (Phase 7)                                                                                                         | Reproducible DoD: seed graph → 3 real iNFTs minted on 0G in ~60s                      |
| Per-package READMEs for `memory / core / inft / mesh / reflection` (Phase 8)                                                          | Install + 10-line quickstart + API table + errors table + links                       |
| [`docs/architecture.md`](docs/architecture.md) (Phase 8)                                                                              | Layered stack diagram, build/run/revoke data flows, trust model                       |
| [`docs/benchmarks.md`](docs/benchmarks.md) + `pnpm benchmark:{loc,inference-rtt,revoke-latency,mesh-throughput,cold-start}` (Phase 8) | Five live-testnet benchmarks; raw JSON committed under `scripts/.benchmarks/`         |
| `revokeMemory` phase instrumentation (Phase 9)                                                                                        | `onPhase` hook + `timings` result; oracle-side refuse now **1.5 s** (<5 s target)     |
| Studio wallet-connect + EIP-712 deploy auth (Phase 9)                                                                                 | Header connect, typed-data sign, backend `STUDIO_SIGNER_ALLOWLIST`, open-mode dev     |
| Server-side codegen echo diff (Phase 9)                                                                                               | Rejects tampered client source before gas; CRLF/newline-tolerant, line-diffed 400     |
| Custom reflection rubrics (Phase 9)                                                                                                   | Inspector textarea for `{ name, description, criteria }`; literal object emitted      |
| [`docs/security.md`](docs/security.md) audit-grade (Phase 9)                                                                          | Attacker-capability threat model, primitives table, L1–L12 production-gap ledger      |
| CI LoC gate (Phase 9)                                                                                                                 | `.github/workflows/ci.yml` runs `pnpm benchmark:loc --check` on every PR              |

## Quickstart — clone → sovereign iNFT on 0G Galileo in <90 seconds

The full paste-able quickstart lives in
[docs/quickstart.md](docs/quickstart.md). The short form:

```bash
git clone https://github.com/irajgill/SovereignClaw.git
cd SovereignClaw
cp .env.example .env
# Fill PRIVATE_KEY (funded wallet from https://faucet.0g.ai) and
# COMPUTE_ROUTER_API_KEY (from https://pc.testnet.0g.ai).

pnpm install
( cd contracts && forge install foundry-rs/forge-std --no-git \
                       && forge install OpenZeppelin/openzeppelin-contracts --no-git \
                       && forge build )
pnpm --filter @sovereignclaw/core --filter @sovereignclaw/memory \
     --filter @sovereignclaw/reflection --filter @sovereignclaw/inft build

cd examples/research-claw && pnpm dev
# Prints TEE-verified inference, a self-critique (reflect.complete with
# score + learningPointer), four encrypted 0G writes, and a chainscan
# URL for your freshly-minted ResearchClaw iNFT.
```

For the full **mint → transfer → revoke** lifecycle (Phase 3, requires the
dev oracle and a second wallet), see
[`examples/agent-mint-transfer-revoke`](examples/agent-mint-transfer-revoke/).

For the **3-agent mesh** flow (Phase 5), once the core + memory + mesh
packages are built:

```bash
pnpm --filter @sovereignclaw/core --filter @sovereignclaw/memory --filter @sovereignclaw/mesh build
cd examples/research-mesh && pnpm dev
# Prints 6 bus events with their 0G root hashes + storagescan URLs, then
# the accepted final answer, score, and round count.
```

For the **visual builder** (Phase 7, ClawStudio): the Studio is a Next.js
app that talks to the backend for deploys.

```bash
# terminal 1
pnpm --filter @sovereignclaw/backend dev
# starts http://localhost:8787 with /studio/* routes enabled as long as
# RPC_URL, INDEXER_URL, and PRIVATE_KEY (or STUDIO_MINTER_PRIVATE_KEY)
# are set in .env.

# terminal 2
pnpm --filter @sovereignclaw/studio dev
# open http://localhost:3030 — the 3-agent research swarm is pre-loaded;
# click Deploy to mint 3 real iNFTs on 0G Galileo in ~60s.

# headless (CI or a fast sanity check)
pnpm smoke:studio
# POSTs the seed graph to the running backend, polls until done, prints
# manifest root + chainscan URLs for every minted iNFT.
```

Reproduce the DX numbers on your own machine:

```bash
pnpm benchmark:cold-start          # wall-time each step, writes JSON report
pnpm benchmark:cold-start --clean  # true cold: wipes node_modules first
```

## Phase 3 highlights

- **EIP-712 byte-equality** between the on-chain `_verifyOracleProof` and
  off-chain `digestForOracleProof` is enforced via a Foundry-emitted
  fixture ([deployments/eip712-typehashes.json](deployments/eip712-typehashes.json))
  that both sides re-derive locally and compare. Drift on either side fails
  CI.
- **Dev oracle** at [apps/backend/](apps/backend/): four endpoints,
  EIP-712-signed proofs, optional bearer auth, dockerized, persistence-gap
  documented at the top of `src/store.ts`.
- **`@sovereignclaw/inft`** ships only ABI JSON + EIP-712 helpers + ethers
  bindings. Zero `@sovereignclaw/core` dep. Typed errors throughout.
- **Honest revocation semantics** are spelled out in
  [docs/security.md](docs/security.md): the chain-enforced parts (DEK zeroed,
  oracle refuses, registry public) and the can-never-happen parts
  (recovering a DEK already in someone's session memory, deleting the
  ciphertext from immutable storage).

## Tests

- **76 Foundry tests** (54 AgentNFT + 11 MemoryRevocation + 6 fuzz + 2
  invariants × 128k calls each + 1 deploy-script + 1 EIP-712 emitter +
  1 Ping legacy). Gas snapshot committed at
  [contracts/.gas-snapshot](contracts/.gas-snapshot).
- **33 inft + 16 backend + (memory + core)** Vitest unit suites. EIP-712
  byte-equality and tamper-detection assertions in both packages.
- **2 inft integration tests** against real testnet (mint + transfer +
  revoke + post-revoke 410). Bootable in CI via the
  [`run-integration` PR label](.github/workflows/integration.yml).

```bash
pnpm contracts:test                 # all 76 Foundry tests
pnpm contracts:snapshot:check       # gas regression gate
pnpm test                           # all unit suites
INTEGRATION=1 pnpm --filter @sovereignclaw/inft test:integration
pnpm check:deployment               # read-only on-chain assertions
```

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
