# contracts/

Foundry project for SovereignClaw smart contracts.

## Status

- Phase 0 — `Ping.sol` smoke contract (kept; harmless and exercises the
  smoke-test artifact path).
- Phase 2 (current) — `AgentNFT.sol` and `MemoryRevocation.sol` deployed
  to 0G Galileo testnet.

## Layout

```
contracts/
├── src/
│   ├── AgentNFT.sol             # ERC-7857-style iNFT
│   ├── MemoryRevocation.sol     # public revocation registry
│   ├── Ping.sol                 # Phase-0 smoke contract
│   └── interfaces/
│       ├── IAgentNFT.sol
│       ├── IMemoryRevocation.sol
│       └── IOracle.sol          # off-chain reference + EIP-712 typehashes
├── script/
│   └── Deploy.s.sol             # deploys MemoryRevocation + AgentNFT
├── test/
│   ├── AgentNFT.t.sol           # 54 unit tests
│   ├── AgentNFTFuzz.t.sol       # 6 fuzz tests
│   ├── AgentNFTInvariant.t.sol  # 2 invariants × 128k calls each
│   ├── MemoryRevocation.t.sol   # 11 unit tests
│   ├── Deploy.t.sol             # exercises Deploy.s.sol against anvil
│   ├── Ping.t.sol               # legacy
│   └── helpers/
│       ├── OracleSigner.sol     # EIP-712 proof builder
│       └── MaliciousReceiver.sol
└── .gas-snapshot                # committed; PR CI blocks regressions
```

## Commands (run from repo root)

```bash
pnpm contracts:build              # forge build
pnpm contracts:test               # forge test -vvv (75 tests)
pnpm contracts:snapshot           # rewrite .gas-snapshot
pnpm contracts:snapshot:check     # CI gate; fails on uncommitted gas changes
pnpm deploy:contracts             # broadcast Deploy.s.sol to 0G Galileo testnet
pnpm verify:contracts             # tries forge verify (currently fails — see below)
pnpm check:deployment             # read-only on-chain sanity checks against record
```

## First-time setup

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts@v5.1.0 --no-git
```

## Deploying

1. Fund the deployer wallet at https://faucet.0g.ai (≥0.05 0G recommended;
   Phase-2 deploy of both contracts measured ~0.014 0G).
2. Set `PRIVATE_KEY` in `.env`. `ORACLE_ADDRESS` is optional in Phase 2 — the
   deploy script defaults to the deployer address as a placeholder oracle and
   logs a clear warning. Phase 3 rotates it via `setOracle` once the dev oracle
   keypair is generated.
3. Run `pnpm deploy:contracts`. The script:
   - predicts the AgentNFT address via `vm.computeCreateAddress`,
   - deploys `MemoryRevocation` with the predicted address baked into its
     immutable `agentNFT` field,
   - deploys `AgentNFT` and asserts the prediction held,
   - reads the broadcast JSON and writes
     [`deployments/0g-testnet.json`](../deployments/0g-testnet.json) with
     addresses, tx hashes, and explorer URLs.
4. Run `pnpm check:deployment` to assert the on-chain wiring matches the record
   (registry binding, oracle, owner, sentinel, name/symbol).

## Source verification on chainscan-galileo.0g.ai

`chainscan-galileo.0g.ai` is a client-rendered React SPA — every path including
`/api`, `/api/v2`, `/api/contracts/verify` returns the same SPA shell, so
`forge verify-contract --verifier blockscout` cannot post to it. This is the
documented fallback path called out in the Phase 2 dev log.

**Manual upload via the explorer UI:**

1. Open the address page on chainscan-galileo for each contract:
   - AgentNFT: https://chainscan-galileo.0g.ai/address/0xc3f997545da4AA8E70C82Aab82ECB48722740601
   - MemoryRevocation: https://chainscan-galileo.0g.ai/address/0x735084C861E64923576D04d678bA2f89f6fbb6AC
2. Find the "Verify and Publish" / "Verify Contract" affordance.
3. Use the **single-file (flattened)** option. Source files are pre-flattened at
   [`deployments/flattened/AgentNFT.flat.sol`](../deployments/flattened/AgentNFT.flat.sol) and
   [`deployments/flattened/MemoryRevocation.flat.sol`](../deployments/flattened/MemoryRevocation.flat.sol).
4. Compiler settings: `0.8.24`, optimizer **enabled**, runs **200**, EVM
   version **default** (the foundry.toml defaults).
5. Constructor args (ABI-encoded, exactly as the deploy used them):

   | Contract         | Encoded constructor args                                                    |
   | ---------------- | --------------------------------------------------------------------------- |
   | MemoryRevocation | `0x000000000000000000000000c3f997545da4aa8e70c82aab82ecb48722740601`        |
   | AgentNFT         | see `deployments/0g-testnet.json` → `verification.constructorArgs.AgentNFT` |

   Full encoded blob for AgentNFT (from the deploy broadcast):
   `0x000000000000000000000000735084c861e64923576d04d678ba2f89f6fbb6ac000000000000000000000000236e59315dd2fc05704915a6a1a7ba4791cc3b5b00000000000000000000000000000000000000000000000000000000000000800000000000000000000000000000000000000000000000000000000000000c00000000000000000000000000000000000000000000000000000000000000013536f7665726569676e436c6177204167656e7400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000753434147454e5400000000000000000000000000000000000000000000000000`

6. Once verified via the UI, set the corresponding `verified.<Contract>: true`
   in `deployments/0g-testnet.json` and commit.

The `pnpm verify:contracts` script remains in place — when 0G ships a Blockscout-
or Etherscan-compatible verification API at chainscan-galileo, the script will
work without modification.

## Trust model (one-paragraph forward-link)

AgentNFT enforces every ownership change through an EIP-712-signed oracle
proof. The oracle holds re-encryption material; transfers replace the
encrypted memory pointer and the wrapped DEK atomically with the ownership
swap. Revocation is irreversible: the on-chain wrappedDEK is zeroed,
`MemoryRevocation` is updated, and the oracle (per its registry) refuses
all future re-encryption requests for that token. The chain enforces
this; well-behaved clients respect it. The oracle is centralized in
Phase 2/3 and TEE-replaceable in production. The full security story
ships in `docs/security.md` in Phase 8 of the roadmap.
