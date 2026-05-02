# SovereignClaw

Sovereign-memory, multi-agent, iNFT-native agent framework for 0G.

> **Status:** Phase 3 — dev oracle and iNFT lifecycle live on 0G Galileo
> testnet. See [docs/dev-log.md](docs/dev-log.md) for build progress.

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

| Layer                                                                                   | Status                                                                |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `@sovereignclaw/memory` (Phase 1)                                                       | Sovereign memory primitives — encrypted, revocable, 0G-Storage-backed |
| `@sovereignclaw/core` (Phase 1)                                                         | Agent runtime, `sealed0GInference` adapter                            |
| `AgentNFT.sol`, `MemoryRevocation.sol` (Phase 2)                                        | ERC-7857 iNFT lifecycle, deployed and pinned                          |
| [`@sovereignclaw/inft`](packages/inft/) (Phase 3)                                       | Mint / transfer-with-reencryption / revoke / recordUsage helpers      |
| [`@sovereignclaw/backend` dev oracle](apps/backend/) (Phase 3)                          | Hono service signing EIP-712 oracle proofs                            |
| [`examples/agent-mint-transfer-revoke`](examples/agent-mint-transfer-revoke/) (Phase 3) | DoD example: full lifecycle on real testnet                           |

## Quickstart — see all three lifecycle txs on chainscan in <10 min

```bash
git clone <repo> && cd sovereignclaw
pnpm install

# 1. Generate a dev-oracle keypair and put it in .env
pnpm gen:oracle-key
# Copy ORACLE_PRIVATE_KEY and ORACLE_ADDRESS into .env (gitignored).
# Also set PRIVATE_KEY (Alice) and BOB_PRIVATE_KEY (Bob) — both funded testnet
# wallets from https://faucet.0g.ai (0.1 0G/day each is plenty).

# 2. Rotate the on-chain AgentNFT.oracle to your dev-oracle address
ORACLE_NEW_ADDRESS=$(grep '^ORACLE_ADDRESS=' .env | cut -d= -f2) pnpm rotate:oracle
pnpm check:deployment   # asserts the rotation took

# 3. Build the workspace packages
pnpm --filter @sovereignclaw/memory --filter @sovereignclaw/inft build

# 4. Start the dev oracle (separate terminal)
pnpm --filter @sovereignclaw/backend dev
# Or: docker compose -f apps/backend/docker-compose.yml --env-file .env up --build

# 5. Run the example end-to-end
cd examples/agent-mint-transfer-revoke && pnpm dev
# Prints three chainscan-galileo URLs: mint, transfer, revoke
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
