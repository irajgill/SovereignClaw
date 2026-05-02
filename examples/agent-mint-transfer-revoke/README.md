# agent-mint-transfer-revoke

Phase 3 Definition-of-Done example. Mints an agent iNFT as Alice, transfers
it to Bob via the oracle re-encryption gate, then revokes the memory as Bob.
Each step prints the chainscan-galileo URL of its tx.

## Quickstart

```bash
# 1. Bring up the dev oracle (separate terminal)
pnpm --filter @sovereignclaw/backend dev
# Confirms: oracle backend up, oracleAddress=0x..., port 8787

# 2. Set up env (from repo root)
cp .env.example .env                            # if you don't already have one
# Edit .env to set:
#   PRIVATE_KEY=0x...    (Alice — funded testnet wallet)
#   BOB_PRIVATE_KEY=0x... (Bob — second funded wallet)
#   ORACLE_PRIVATE_KEY=0x... (run `pnpm gen:oracle-key` and put the value here)
#   ORACLE_ADDRESS=0x... (matches the address `gen:oracle-key` returned)

# 3. Build packages once so the example can resolve workspace deps
pnpm install
pnpm --filter @sovereignclaw/memory build
pnpm --filter @sovereignclaw/inft build

# 4. Make sure the on-chain oracle is your dev key
ORACLE_NEW_ADDRESS=$ORACLE_ADDRESS pnpm rotate:oracle    # one-time per env
pnpm check:deployment                                    # 9/9 green

# 5. Run the example (real txs go on 0G Galileo testnet)
cd examples/agent-mint-transfer-revoke
pnpm install   # hooks in workspace deps
pnpm dev
```

## What it does

1. Loads Alice and Bob from env. Both must be funded wallets on
   0G Galileo testnet (see [https://faucet.0g.ai](https://faucet.0g.ai)).
2. Connects to the local dev oracle and confirms it's bound to the same
   AgentNFT and chain you have in `deployments/0g-testnet.json`. Aborts if
   the on-chain `AgentNFT.oracle()` does not match the backend's oracle key
   (in that case run `pnpm rotate:oracle`).
3. Builds an `encrypted(OG_Log(...))` provider for Alice, writes a record,
   flushes to 0G Storage, captures the pointer.
4. Mints token #N to Alice via `mintAgentNFT`. Prints tx hash + URL.
5. Transfers the token to Bob via `transferAgentNFT` — calls the oracle's
   `/oracle/reencrypt`, gets a signed proof, submits the contract tx.
   Asserts `ownerOf(tokenId) === bob` and `tokenNonce(tokenId) === 1`.
6. Revokes via `revokeMemory` as Bob — calls `/oracle/revoke`, submits
   `AgentNFT.revoke`. Asserts:
   - `AgentNFT.getAgent(tokenId).revoked === true`
   - `AgentNFT.getAgent(tokenId).wrappedDEK === '0x'` (storage freed)
   - `MemoryRevocation.isRevoked(tokenId) === true`
   - subsequent `oracle.reencrypt` for the same tokenId throws
     `OracleRevokedError` (HTTP 410).

## Expected output

JSON-per-line. The interesting lines are `mint`, `transfer`, `revoke`,
each carrying `txHash` and `explorerUrl`. The final `done` block summarizes
the three explorer URLs.

```json
{ "step": "mint",     "tokenId": "1", "txHash": "0x...", "explorerUrl": "https://chainscan-galileo.0g.ai/tx/0x..." }
{ "step": "transfer", "tokenId": "1", "txHash": "0x...", "explorerUrl": "https://chainscan-galileo.0g.ai/tx/0x..." }
{ "step": "revoke",   "tokenId": "1", "txHash": "0x...", "explorerUrl": "https://chainscan-galileo.0g.ai/tx/0x..." }
```

## Costs (measured Phase 3)

| Step                        | Approx 0G burned |
| --------------------------- | ---------------- |
| Storage upload (1 KB)       | ~0.000123 0G     |
| Mint                        | ~0.0008 0G       |
| Transfer with re-encryption | ~0.0006 0G       |
| Revoke                      | ~0.0005 0G       |
| **Total per run**           | **~0.002 0G**    |

The faucet allowance (0.1 0G/day) covers ~50 full runs per wallet. Bob also
needs a small balance because revoke is signed by him — fund Bob with 0.01 0G
once and it covers many runs.

## Two-balance model reminder (Phase 0 risk #21)

The Compute Router uses a separate balance funded via
`https://pc.testnet.0g.ai`. This example does not call Router (no inference)
and therefore does not need a Router deposit. If you extend it to add a
`run()` step using `@sovereignclaw/core`'s `sealed0GInference`, you will hit
HTTP 402 from Router until you make the deposit; the inference adapter
throws `RouterBalanceError` with the deposit URL hint when this happens.

## Troubleshooting

- `oracle mismatch: AgentNFT.oracle=...` — your backend uses a different
  `ORACLE_PRIVATE_KEY` than the chain expects. Run `pnpm rotate:oracle`
  with `ORACLE_NEW_ADDRESS` set to the backend's address.
- `OracleUnreachableError` — backend not running. Start it with
  `pnpm --filter @sovereignclaw/backend dev`.
- `RouterBalanceError` (only if you add inference) — go to
  `https://pc.testnet.0g.ai` and deposit testnet 0G into your Router balance.
- Token already in use / `TokenRevoked` — the script always mints a fresh
  token; this only fires if you reuse a tokenId between runs.
