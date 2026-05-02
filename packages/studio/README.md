# @sovereignclaw/studio

**ClawStudio** — a Next.js 14 drag-and-drop builder that turns a visual
graph into deployable SovereignClaw agents + iNFTs on 0G.

This package is a **deployable web app**, not a library. It does not
publish to npm. Run it locally with `pnpm --filter @sovereignclaw/studio dev`
and point your browser at [http://localhost:3030](http://localhost:3030).

## What it does

1. **Canvas** — React Flow with 6 node types:
   - `memory` — sovereign memory on 0G Log (encrypted or plain)
   - `inference` — TEE-verified 0G compute model
   - `tool` — http / onchain / file handle (scaffolded, full runtime in IncomeClaw)
   - `reflection` — `reflectOnOutput()` config (rubric, threshold, rounds)
   - `agent` — role + system prompt; mints one iNFT per node on deploy
   - `mesh` — `planExecuteCritique` orchestrator with planner/executor/critic wiring
2. **Inspector** — click any node to edit its configuration in a form.
   Dependencies and validation errors show live.
3. **Code preview** — Monaco editor streams the generated SovereignClaw
   TypeScript on the right. The generator is a pure function
   (`lib/codegen.ts`) with snapshot tests — the same graph always
   produces the same source byte-for-byte.
4. **Issues tab** — real-time validator errors (missing inference on an
   agent, duplicate roles, mesh missing a critic, etc.).
5. **Deploy** — POSTs the graph + generated code to the backend at
   `/studio/deploy`. Status polling updates as the backend bundles,
   writes the manifest to 0G Storage, and mints one iNFT per agent.
   Chainscan links appear inline the moment each mint confirms.

## Quickstart

```bash
# terminal 1 — backend with /studio/* routes
pnpm --filter @sovereignclaw/backend dev

# terminal 2 — this app
pnpm --filter @sovereignclaw/studio dev
```

Both commands need the repo-root `.env` to be populated (same file the
Phase 3–6 examples use). In particular:

- `RPC_URL`, `INDEXER_URL`, `STORAGE_EXPLORER_URL` — 0G Galileo endpoints.
- `PRIVATE_KEY` (or `STUDIO_MINTER_PRIVATE_KEY`) — funded wallet that
  mints iNFTs on behalf of deploys. v0 mints with the backend's key;
  browser wallet-signed manifests are Phase 7.1 carryover.

Open [http://localhost:3030](http://localhost:3030). The canvas loads
with the pre-built **3-agent research swarm** (planner + executor +
critic + mesh). Click **Deploy 3 iNFTs**, watch the status panel:

- `queued` → `bundling` → `writing-manifest` → `minting` → `done`
- one explorer link per agent when its mint confirms

Expected wall-clock: **~60 seconds** on 0G Galileo for 3 iNFTs +
manifest (measured 2026-05-02).

## Dev commands

```bash
pnpm dev         # next dev on port 3030
pnpm build       # next build (production bundle, 146 kB first-load JS)
pnpm start       # serve the production build
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest (codegen + validator, 15 tests)
pnpm lint        # eslint app components lib test
```

## Headless smoke test

From the repo root, with the backend running:

```bash
pnpm smoke:studio
```

POSTs the built-in seed graph to the backend, polls until the deploy
completes, and prints the manifest root + every agent's tokenId and
Chainscan URL. Same path the browser Deploy button exercises.

## v0 cut line (vs §11 of the roadmap)

- **Backend mints with its own key.** The spec envisions a browser-
  signed EIP-712 manifest; v0 ships without wallet-connect so judges
  can deploy without installing MetaMask. Wallet-connect + signature
  verification is Phase 7.1 carryover.
- **esbuild does validation, not execution.** The deploy pipeline
  verifies the generated code parses; it does not host long-running
  agents. Agent runtime hosting is Phase 8+.
- **Shared manifest per deploy.** One manifest pointer backs every
  agent iNFT in the same deploy. IncomeClaw splits this per agent.

See [`docs/dev-log.md`](../../docs/dev-log.md) for the full list and
deferred-to-later items.

## License

Apache 2.0. See [LICENSE](../../LICENSE).
