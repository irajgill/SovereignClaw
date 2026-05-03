# research-claw

Phase 4 + Phase 6 Definition-of-Done example. A sovereign, encrypted,
iNFT-minted research agent running end-to-end on real 0G Galileo testnet in
~120 LoC of agent wiring.

This example is **deliberately not a workspace member of the SovereignClaw
monorepo**. It pins exact published `@sovereignclaw/*` versions on npm so a
judge can copy this directory anywhere on disk, run `pnpm install`, and have
a working agent in under 10 minutes — no monorepo build cycle, no
`workspace:*` resolution, no local plumbing.

## What it does

1. Derives a wallet-bound KEK (EIP-191 sig → HKDF-SHA-256 → 256-bit AES key).
2. Wraps `OG_Log` memory + history in the `encrypted()` provider — every byte
   on 0G Storage is AES-256-GCM ciphertext.
3. Builds an `Agent` with a researcher system prompt and the Router-backed
   `sealed0GInference` adapter (`verify_tee: true`).
4. Adds `reflectOnOutput({ rubric: 'accuracy', rounds: 1, persistLearnings:
true })` so a self-critique pass scores every run and persists a
   `learning:<runId>` record to history. Subsequent runs auto-load recent
   learnings into context.
5. Runs the agent on a research question. Prints the TEE attestation,
   provider address, latency, and per-call billing.
6. Writes an agent manifest to memory, captures the 0G root hash, mints an
   ERC-7857 iNFT via `@sovereignclaw/inft`. Prints the chainscan-galileo URL.
7. Calls `listRecentLearnings(history, 5)` to confirm the learning is
   queryable.

## Quickstart (standalone — what a judge would do)

The example does not require cloning the whole SovereignClaw monorepo.
Copy this directory anywhere, fill `.env`, run.

```bash
# 1. Copy the example anywhere on disk.
cp -r examples/research-claw /tmp/research-claw && cd /tmp/research-claw

# 2. Configure env. The .env.example below lists every var the script reads.
cp .env.example .env
# Edit .env with:
#   PRIVATE_KEY=0x...                  (funded wallet — https://faucet.0g.ai)
#   COMPUTE_ROUTER_API_KEY=sk-...      (https://pc.testnet.0g.ai → deposit + key)

# 3. Install deps from npm. No workspace setup needed.
pnpm install

# 4. Run.
pnpm dev
```

Target: clone-to-iNFT in **<10 min** (assuming a funded wallet + Router key).

## Quickstart (inside the SovereignClaw monorepo)

From the root of the repo, the same example runs against your local-built
`dist/` of each package — handy for iterating on framework changes.

```bash
git clone https://github.com/irajgill/SovereignClaw.git
cd SovereignClaw
cp .env.example .env  # Fill PRIVATE_KEY + COMPUTE_ROUTER_API_KEY at minimum
pnpm install
( cd contracts && forge install foundry-rs/forge-std --no-git \
                  && forge install OpenZeppelin/openzeppelin-contracts --no-git )
pnpm contracts:build
pnpm --filter @sovereignclaw/example-research-claw dev
```

The example dir is intentionally not in `pnpm-workspace.yaml`. The two-step
flow `pnpm --filter ... dev` resolves against the example's own
`node_modules` (populated from npm) — exactly the standalone path.

## Required env

| Var                       | Where to get it                                                                        |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `PRIVATE_KEY`             | Any 0G Galileo testnet wallet. Fund at https://faucet.0g.ai (0.1 0G/day).              |
| `RPC_URL`                 | `https://evmrpc-testnet.0g.ai`                                                         |
| `INDEXER_URL`             | `https://indexer-storage-testnet-turbo.0g.ai`                                          |
| `EXPLORER_URL`            | `https://chainscan-galileo.0g.ai`                                                      |
| `COMPUTE_ROUTER_BASE_URL` | `https://router-api-testnet.integratenetwork.work/v1`                                  |
| `COMPUTE_ROUTER_API_KEY`  | Issue at https://pc.testnet.0g.ai (separate Router balance, deposit testnet 0G first). |
| `COMPUTE_MODEL` (opt)     | Defaults to `qwen/qwen-2.5-7b-instruct`.                                               |
| `KEK_NAMESPACE` (opt)     | Logical key derivation namespace; defaults to `research-claw-v1`.                      |

The bundled `.env.example` enumerates all of these.

## Expected output (real run)

A typical run on the live Router emits ~12 JSON-per-line steps:

```
{ "step": "start", "owner": "0x236E...3b5B", "chainId": 16602, ... }
{ "step": "run.start", "runId": "...uuid..." }
{ "step": "run.complete", "runId": "...", "latencyMs": 4321, "teeVerified": true,
  "providerAddress": "0xa48f...7836", "totalCostWei": "1234500000000" }
{ "step": "reflect.start", "runId": "..." }
{ "step": "reflect.complete", "runId": "...", "accepted": true, "rounds": 1, "score": 0.85,
  "learningPointer": "0x..." }
=== ResearchClaw output ===
The three most cited papers on retrieval-augmented generation from 2024 are: ...
===========================
{ "step": "manifest", "pointer": "0x...64-hex..." }
{ "step": "mint", "tokenId": "<N>", "txHash": "0x...",
  "explorerUrl": "https://chainscan-galileo.0g.ai/tx/0x..." }
{ "step": "learnings.recent", "count": 1, "entries": [ ... ] }
{ "step": "done", "summary": "ResearchClaw ran with reflection, persisted ...",
  "explorerUrl": "https://chainscan-galileo.0g.ai/tx/0x...", "tokenId": "<N>" }
```

Click the `explorerUrl` to verify the iNFT mint on chainscan-galileo. Click
the `learningPointer` to find the encrypted reflection write on
`storagescan-galileo.0g.ai`.

## What the four bullets above prove

This is the framework's hero example because it touches every primitive in
one ~120-line script:

- **Sovereign Memory** — wallet-derived KEK, AES-256-GCM, 0G Log pointers
- **Verifiable Inference** — `verify_tee: true` flag, `tee_verified=true`
  in the response trace
- **iNFT Lifecycle** — one-call mint via `@sovereignclaw/inft`, real on-chain
  AgentNFT mint
- **Reflection** — second inference pass, scored, persisted as
  `learning:<runId>`, queried via `listRecentLearnings`

If a judge can run this and click through the explorer links, the framework
works.

## Costs (measured)

| Step                          | Approx 0G burned                               |
| ----------------------------- | ---------------------------------------------- |
| Manifest write to 0G Storage  | ~0.000123 0G                                   |
| Inference (Router billing)    | varies by model; qwen-2.5-7b ≈ 0.000002 0G/run |
| Reflection (second inference) | same as above                                  |
| iNFT mint                     | ~0.0008 0G                                     |
| **Total per run**             | **~0.001 0G**                                  |

The faucet allowance (0.1 0G/day) covers ~100 full runs per wallet.

## Two-balance reminder

The Compute Router uses a **separate** balance funded via
`https://pc.testnet.0g.ai`. A wallet with faucet funds is enough for storage

- chain gas, but inference calls will return HTTP 402 until you also deposit
  into the Router. The inference adapter throws `RouterBalanceError` with the
  deposit URL hint when this happens. Fund both balances once and you're good
  for the day.
