# Quickstart

From a clean clone to a live iNFT in **under 10 minutes** — a TEE-verified
inference, three encrypted writes on 0G Storage, and a mint tx on 0G Chain,
all from a single `pnpm dev`.

> **Target audience:** a reviewer who has never seen this repo. Paste and go.

## Prerequisites

| Tool | Version | Install |
| --- | --- | --- |
| Node.js | 22 LTS | https://nodejs.org / `nvm install 22` |
| pnpm | 9+ | `corepack enable && corepack prepare pnpm@9 --activate` |
| Foundry | latest | `curl -L https://foundry.paradigm.xyz \| bash && foundryup` |
| git | any recent | (system package manager) |

You also need **two testnet balances** on 0G Galileo (chainId `16602`):

1. **Wallet** — funds gas for storage writes and the mint. Free from
   https://faucet.0g.ai (0.1 0G/day is more than enough).
2. **Router** — funds inference calls. Deposit at
   https://pc.testnet.0g.ai and copy the issued API key.

Both are decoupled. A tiny deposit on each (~0.01 0G) carries you through
tens of ResearchClaw runs.

## 1. Clone and configure env

```bash
git clone https://github.com/irajgill/SovereignClaw.git
cd SovereignClaw
cp .env.example .env
```

Open `.env` and fill, at minimum:

```dotenv
PRIVATE_KEY=0x...                               # funded 0G Galileo wallet
COMPUTE_ROUTER_API_KEY=sk-...                   # from https://pc.testnet.0g.ai
```

Everything else (`RPC_URL`, `INDEXER_URL`, `EXPLORER_URL`, `COMPUTE_MODEL`,
etc.) is pre-set for the public testnet.

If you also plan to run the Phase 3 mint → transfer → revoke example, you
will additionally need `BOB_PRIVATE_KEY` and a dev oracle (see
`examples/agent-mint-transfer-revoke/README.md`). ResearchClaw does not need
those.

## 2. Install JavaScript + Solidity deps

```bash
pnpm install
(
  cd contracts
  forge install foundry-rs/forge-std --no-git
  forge install OpenZeppelin/openzeppelin-contracts --no-git
  forge build
)
```

The `forge build` step produces `contracts/out/AgentNFT.sol/AgentNFT.json`
which `@sovereignclaw/inft` imports for its ABI bindings.

## 3. Build the workspace packages

```bash
pnpm --filter @sovereignclaw/core \
     --filter @sovereignclaw/memory \
     --filter @sovereignclaw/inft build
```

## 4. Sanity-check your setup

```bash
pnpm check:deployment    # 10/10 on-chain assertions
pnpm smoke:storage       # writes 1 KB to 0G, reads it back
pnpm smoke:compute       # one inference call, asserts tee_verified: true
```

`pnpm check:deployment` asserts the live `AgentNFT` and `MemoryRevocation`
contracts on Galileo still match the committed record in
`deployments/0g-testnet.json`. It takes ~4 seconds.

`pnpm smoke:storage` and `pnpm smoke:compute` are the Phase 0 rails — if
either fails, ResearchClaw will too.

## 5. Run ResearchClaw

```bash
cd examples/research-claw
pnpm dev
```

Expected: ~80 seconds end-to-end on a fresh machine (two storage uploads,
one inference call, one manifest write, one mint tx). Output looks like:

```json
{ "step": "start", "owner": "0x...", "chainId": 16602, "AgentNFT": "0xc3f9975...", "model": "qwen/qwen-2.5-7b-instruct" }
{ "step": "run.start", "runId": "..." }
{ "step": "run.complete", "runId": "...", "latencyMs": 7738, "teeVerified": true, "providerAddress": "0xa48f...", "totalCostWei": "54850000000000" }

=== ResearchClaw output ===
<model answer>
===========================

{ "step": "manifest", "pointer": "0x6bbbe5...bb08de" }
{ "step": "mint", "tokenId": "11", "txHash": "0x76e7c8...56717", "explorerUrl": "https://chainscan-galileo.0g.ai/tx/0x..." }
{ "step": "done", "summary": "ResearchClaw ran, persisted encrypted memory on 0G, and minted the agent as an iNFT." }
```

Click the `explorerUrl` to see your newly minted iNFT on chainscan-galileo.

## What just happened

| You did | Under the hood |
| --- | --- |
| `pnpm dev` | Loaded `.env`, bound a signer to 0G Galileo. |
| — | Derived a KEK from your wallet signature (EIP-191 → HKDF-SHA-256). |
| — | Built `encrypted(OG_Log(...))` providers — AES-256-GCM on every write. |
| — | Called 0G Compute Router with `verify_tee: true`. |
| Saw `teeVerified: true` | `x_0g_trace.tee_verified` in the Router response, signed by the provider's TEE attestation. |
| — | Wrote context + history + manifest to 0G Storage Log. |
| Saw `tokenId: 11` | `AgentNFT.mint(...)` tx on 0G Chain at `0xc3f9975...`. |

Four primitives, one command, all real on-chain artifacts.

## Cold-start benchmark

Want to verify the <10 min claim on your machine?

```bash
pnpm benchmark:cold-start            # in-place (uses current node_modules)
pnpm benchmark:cold-start --clean    # true cold: wipes node_modules first
pnpm benchmark:cold-start --skip-run # no live testnet call (CI smoke)
```

The benchmark times five steps and writes a JSON report to
`scripts/.benchmarks/cold-start.json`. Measured reference numbers from the
Phase 4 DoD run on a Linux x64 workstation (Node 23.3, in-place flags):

| Step                | Time    | Notes                                                       |
| ------------------- | ------- | ----------------------------------------------------------- |
| `pnpm install`      | ~1s     | warm lockfile, no network fetches                           |
| `forge install`     | skipped | `contracts/lib/*` already present                           |
| `forge build`       | ~0.1s   | incremental                                                 |
| `pkg-build`         | ~4s     | core + memory + inft in parallel                            |
| `research-claw-run` | ~80s    | 3 storage writes + inference + mint                         |
| **Total**           | **~85s** | — see `scripts/.benchmarks/cold-start.json`                |

A true first-clone cold start (wiping `node_modules` and `contracts/lib`)
adds ~10s for `pnpm install` downloads and ~15s for `forge install`,
putting the clone-to-mint path at roughly **2 minutes of wall time**. The
<10 min DX target in `claude.md` §16 has substantial headroom.

### Honest flake note

The pinned `@0gfoundation/0g-ts-sdk@1.2.1` rotates across 0G indexer nodes
that advertise inconsistent storage fees. In the Phase 4 verification
session, roughly **1 in 3 runs** reverted on the first storage upload with
`status=0` on the Flow contract. A simple retry of `pnpm dev` hit a
different node and succeeded. If you're scripting around this, handle the
`StorageSdkError` thrown by `@sovereignclaw/memory` and retry up to 3 times.
See `docs/dev-log.md` Phase 3 for the tracking note.

## Troubleshooting

### `missing required env var PRIVATE_KEY`
Copy `.env.example` → `.env` and fill `PRIVATE_KEY`. The loader walks from
example dir up to the repo root, so either location works.

### `RouterBalanceError` / HTTP 402 on the inference call
The Router account tied to `COMPUTE_ROUTER_API_KEY` has zero balance.
Deposit testnet 0G at https://pc.testnet.0g.ai and retry.

### `StorageSdkError: OG_Log: upload failed ...  status=0`
Transient indexer-node flake on the pinned `@0gfoundation/0g-ts-sdk@1.2.1`.
Retry once or twice — each retry rotates to a different storage node. See
`docs/dev-log.md` Phase 3 for the tracking note.

### `Cannot find module '@sovereignclaw/core'` (or memory/inft)
You skipped step 3. Run the workspace builds.

### `Cannot find module '../../../contracts/out/AgentNFT.sol/AgentNFT.json'`
You skipped `forge build`. Run step 2's contracts block.

### `MintError: contract call reverted`
Your wallet is probably out of gas. Check the balance:
```bash
node -e "const e=require('ethers'); (async()=>{ const p=new e.JsonRpcProvider('https://evmrpc-testnet.0g.ai'); console.log(e.formatEther(await p.getBalance('0xYOUR_ADDRESS')), '0G'); })()"
```
Top up at https://faucet.0g.ai.

### `check:deployment` fails with `oracle mismatch`
Only matters for the Phase 3 example — ResearchClaw does not touch the
oracle.

## Next

- `examples/agent-mint-transfer-revoke/` — Phase 3 lifecycle (transfer with
  re-encryption + revoke).
- `docs/security.md` — the trust model and the dev-oracle caveat.
- `docs/dev-log.md` — phase-by-phase build log.
