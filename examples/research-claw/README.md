# research-claw

Phase 4 Definition-of-Done example. A sovereign, encrypted, iNFT-minted
research agent running end-to-end on real 0G Galileo testnet in ~80 LoC of
agent wiring.

## What it does

1. Derives a wallet-bound KEK (EIP-191 sig → HKDF-SHA-256 → 256-bit AES key).
2. Wraps `OG_Log` memory + history in the `encrypted()` provider — every byte
   on 0G Storage is AES-256-GCM ciphertext.
3. Builds an `Agent` with a researcher system prompt and the Router-backed
   `sealed0GInference` adapter (`verify_tee: true`).
4. Runs the agent on a research question. Prints the TEE attestation,
   provider address, latency, and per-call billing.
5. Writes an agent manifest to memory, captures the 0G root hash, mints an
   ERC-7857 iNFT via `@sovereignclaw/inft`. Prints the chainscan-galileo URL.

Reflection is a Phase 6 add-on; see `docs/dev-log.md` for the phase map.

## Quickstart

From a clean clone. If you've already done the root-level setup
(`docs/quickstart.md`) you can skip straight to step 5.

```bash
# 1. Clone + enter
git clone https://github.com/irajgill/SovereignClaw.git
cd SovereignClaw

# 2. Configure env (copy template, fill PRIVATE_KEY with a funded 0G Galileo wallet)
cp .env.example .env
# At minimum set:
#   PRIVATE_KEY=0x...                          (funded wallet - https://faucet.0g.ai)
#   COMPUTE_ROUTER_API_KEY=sk-...              (https://pc.testnet.0g.ai -> deposit + issue key)

# 3. Install deps + fetch Foundry libs
pnpm install
( cd contracts && forge install foundry-rs/forge-std --no-git \
                       && forge install OpenZeppelin/openzeppelin-contracts --no-git \
                       && forge build )

# 4. Build workspace packages
pnpm --filter @sovereignclaw/core \
     --filter @sovereignclaw/memory \
     --filter @sovereignclaw/inft build

# 5. Run ResearchClaw
cd examples/research-claw
pnpm dev
# Optional: override the question
pnpm dev "What are the open problems in mechanistic interpretability?"
```

## Expected output

JSON-per-line. Four structured events before the free-form answer, then
`manifest`, `mint`, and `done` after.

```json
{ "step": "start",        "owner": "0x...", "chainId": 16602, "AgentNFT": "0xc3f997...", "model": "qwen/qwen-2.5-7b-instruct" }
{ "step": "run.input",    "question": "Summarize the three most cited papers..." }
{ "step": "run.start",    "runId": "..." }
{ "step": "run.complete", "runId": "...", "latencyMs": 7738, "teeVerified": true, "providerAddress": "0xa48f01...", "totalCostWei": "54850000000000" }

=== ResearchClaw output ===
<model answer, ~500–1000 tokens>
===========================

{ "step": "manifest", "pointer": "0x6bbbe5...33bb08de" }
{ "step": "mint",     "tokenId": "11", "txHash": "0x76e7c8...91a56717", "explorerUrl": "https://chainscan-galileo.0g.ai/tx/0x76e7c8..." }
{ "step": "done",     "summary": "ResearchClaw ran, persisted encrypted memory on 0G, and minted the agent as an iNFT." }
```

## Costs (measured, first run)

Reference values from the Phase 4 DoD run (tokenId #11). Your fees will
differ slightly because the 0G indexer re-prices each upload.

| Step                                | ~0G burned      | Where                |
| ----------------------------------- | --------------- | -------------------- |
| Memory write — context (3.9 KB)     | ~0.000493 0G    | wallet (storage fee) |
| History write — run record (3.8 KB) | ~0.000461 0G    | wallet (storage fee) |
| Memory write — manifest (480 B)     | ~0.0000615 0G   | wallet (storage fee) |
| Inference (qwen-2.5-7b, ~900 tok)   | 54,850 Gwei     | Router balance       |
| Mint (AgentNFT.mint)                | ~0.0008 0G      | wallet (gas)         |
| **Per-run wallet total**            | **~0.002 0G**   | wallet               |
| **Per-run Router total**            | **~0.00006 0G** | Router balance       |

The faucet allowance (0.1 0G/day) covers ~50 runs per wallet on the chain side.
Router has a separate balance funded at https://pc.testnet.0g.ai — a small
deposit (~0.01 0G) covers thousands of inference calls at this size.

## Verify the run on-chain

Every Phase 4 run leaves three verifiable artifacts:

1. **Inference**: TEE attestation in the output (`teeVerified: true`, plus
   `providerAddress` — lookup-able on chainscan).
2. **Memory**: three 0G Storage txs (two agent writes + one manifest). Each
   tx hash prints in the SDK log; plug any into
   `https://storagescan-galileo.0g.ai/tx/<hash>`.
3. **iNFT**: the mint tx goes to `AgentNFT` at
   `0xc3f997545da4AA8E70C82Aab82ECB48722740601`. Open the `explorerUrl` from
   the `mint` line; token `#<tokenId>` is now owned by your wallet.

## Troubleshooting

- **`missing required env var PRIVATE_KEY`** — copy `.env.example` to `.env`
  at the repo root (or in this example's dir), fill in a funded wallet.
- **`RouterBalanceError`** — your Router account has zero balance. Deposit
  testnet 0G at https://pc.testnet.0g.ai. The error message carries the
  exact URL.
- **`StorageSdkError: upload failed` with a `status=0` receipt** — known
  transient on the pinned `@0gfoundation/0g-ts-sdk@1.2.1` against live
  testnet (indexer-node price-discovery drift). Retry `pnpm dev` 1–2 times;
  each retry rotates to a different storage node. See `docs/dev-log.md`
  Phase 3 for the tracking note.
- **`Cannot find module '@sovereignclaw/core'`** — you haven't built the
  workspace yet. Run step 4 of the quickstart.
- **`MintError: contract call reverted`** — check `pnpm check:deployment`
  from the repo root; all 10 assertions should pass before trying to mint.

## Extending

- Swap the question from the CLI:
  `pnpm dev "Explain entropy coding in neural video codecs"`
- Change the model: set `COMPUTE_MODEL` in `.env`. Any Router-available
  model works; TEE attestation is surfaced as-is.
- Add tools: `@sovereignclaw/core` exposes `defineTool` and ships
  `httpRequestTool`. Pass a `tools: [...]` array into the `Agent` config.
- Persist reflection learnings: wait for Phase 6
  (`@sovereignclaw/reflection`) — ResearchClaw is the canonical demo for it.
