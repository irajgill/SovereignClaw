# SovereignClaw

Sovereign-memory, multi-agent, iNFT-native agent framework for 0G.

> **Status:** Phase 2 — smart contracts shipped. See [docs/dev-log.md](docs/dev-log.md) for build progress.

## Deployed addresses (0G Galileo Testnet, chainId `16602`)

| Contract           | Address | Explorer |
|---|---|---|
| AgentNFT           | `0xc3f997545da4AA8E70C82Aab82ECB48722740601` | [chainscan](https://chainscan-galileo.0g.ai/address/0xc3f997545da4AA8E70C82Aab82ECB48722740601) |
| MemoryRevocation   | `0x735084C861E64923576D04d678bA2f89f6fbb6AC` | [chainscan](https://chainscan-galileo.0g.ai/address/0x735084C861E64923576D04d678bA2f89f6fbb6AC) |

Source verification on chainscan-galileo is currently manual via the explorer
UI — flattened single-file sources are committed under
[deployments/flattened/](deployments/flattened/) for upload. See
[contracts/README.md](contracts/README.md) for instructions and the constructor-
args ABI encoding. The full deployment record (tx hashes, deployer, oracle,
constructor args) lives in [deployments/0g-testnet.json](deployments/0g-testnet.json).

Run `pnpm check:deployment` at any time to assert that the live contract state
on 0G matches the committed record (binding, oracle, owner, name, symbol, and
the `DESTROYED_SENTINEL` constant). It currently passes 9/9 checks.

## Phase 2 contracts at a glance

- **AgentNFT** — ERC-7857-style iNFT. `mint` / `transferWithReencryption` /
  `revoke` / `recordUsage` / `authorizeUsage` / `setOracle`. Standard ERC-721
  transfer, approve, and operator paths are disabled — every ownership change
  must go through the oracle re-encryption gate so the new owner can read
  agent memory. EIP-712 typed-data oracle proofs with per-token monotonic
  nonces. See [contracts/src/AgentNFT.sol](contracts/src/AgentNFT.sol) and
  [contracts/src/interfaces/IAgentNFT.sol](contracts/src/interfaces/IAgentNFT.sol).
- **MemoryRevocation** — public revocation registry. Bound to AgentNFT at
  construction (immutable). Only the bound AgentNFT may write. Anyone may
  read via `isRevoked` / `getRevocation`. See
  [contracts/src/MemoryRevocation.sol](contracts/src/MemoryRevocation.sol)
  and its interface [contracts/src/interfaces/IMemoryRevocation.sol](contracts/src/interfaces/IMemoryRevocation.sol).
- **Oracle proof shape** — locked in
  [contracts/src/interfaces/IOracle.sol](contracts/src/interfaces/IOracle.sol).
  Phase 3 (`@sovereignclaw/inft` + `apps/backend/src/routes/oracle/`) implements
  the off-chain signer against this exact EIP-712 domain.

## Tests

- 75 Foundry tests (54 unit + 11 MemoryRevocation + 6 fuzz + 2 invariant +
  1 deploy-script + 1 Ping legacy). Invariant suite runs 256 × 500 calls per
  property — 128,000 randomized handler invocations each, 0 reverts.
- Gas snapshot committed at [contracts/.gas-snapshot](contracts/.gas-snapshot).
  CI gate: `pnpm contracts:snapshot:check` fails on uncommitted regressions.

```
pnpm contracts:test           # full Foundry suite
pnpm contracts:snapshot:check # ensure committed snapshot still holds
pnpm check:deployment         # read-only on-chain assertions
```

## License

Apache 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
