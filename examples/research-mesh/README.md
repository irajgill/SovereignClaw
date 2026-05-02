# ResearchMesh

Phase 5 Definition-of-Done example for SovereignClaw. Spins up three agents — planner, executor, critic — and runs the `planExecuteCritique` pattern from `@sovereignclaw/mesh` against the **real** 0G Galileo testnet. Every bus event is AES-256-GCM encrypted and written to a 0G Log namespace, so reviewers can verify the full 3-agent flow on `storagescan-galileo.0g.ai`.

## What this proves

- `@sovereignclaw/mesh` exposes a working `Mesh` + `Bus` over any `MemoryProvider`.
- A single call to `planExecuteCritique({ planner, executors, critic, task })` runs the full pipeline and emits typed bus events for each step.
- Bus events land on 0G Log as ciphertext — only the wallet that derived the KEK can read them.
- Replay: `mesh.bus.replay()` reconstructs every event in seq order (same process; cross-process replay is Phase 5.1).

## Prereqs

1. `.env` at repo root (see `.env.example`) with:
   - `PRIVATE_KEY` — funded on 0G Galileo (https://faucet.0g.ai)
   - `RPC_URL`, `INDEXER_URL`
   - `COMPUTE_ROUTER_BASE_URL`, `COMPUTE_ROUTER_API_KEY`, `COMPUTE_MODEL`
   - optional: `STORAGE_EXPLORER_URL` (defaults to chain docs URL)
2. Router account funded for your chosen model (https://pc.testnet.0g.ai).
3. Workspaces built at least once:
   ```bash
   pnpm install
   pnpm --filter @sovereignclaw/core \
        --filter @sovereignclaw/memory \
        --filter @sovereignclaw/mesh build
   ```

## Run

```bash
# Default task (small, deterministic — useful for smoke tests)
pnpm --filter @sovereignclaw/example-research-mesh dev

# Custom task
pnpm --filter @sovereignclaw/example-research-mesh dev -- \
  "List the three most cited RAG papers from 2024 with authors and venue."
```

## What the output looks like

```
{"step":"start","meshId":"research-mesh-v1-m2k3j0","owner":"0x...","model":"qwen/qwen-2.5-7b-instruct",...}
{"step":"task","task":"Name the 2017 paper..."}
{"step":"bus.event","seq":0,"type":"task.created","from":"mesh","parentSeq":null}
{"step":"bus.event","seq":1,"type":"plan.created","from":"planner","parentSeq":0}
{"step":"bus.event","seq":2,"type":"execution.started","from":"executor","parentSeq":1}
{"step":"bus.event","seq":3,"type":"execution.complete","from":"executor","parentSeq":2}
{"step":"bus.event","seq":4,"type":"critique.created","from":"critic","parentSeq":3}
{"step":"bus.event","seq":5,"type":"task.complete","from":"mesh","parentSeq":4}

=== ResearchMesh output ===
The 2017 paper is "Attention Is All You Need" by Vaswani et al., published at NeurIPS.
===========================

{"step":"result","rounds":1,"score":0.9,"acceptedExecutor":"executor","elapsedMs":...,"eventCount":6}

=== Bus events on 0G (verifiable) ===
evt:0000000000000000  root=0x...  https://storagescan-galileo.0g.ai/tx/0x...
evt:0000000000000001  root=0x...  https://storagescan-galileo.0g.ai/tx/0x...
...
=====================================
```

## Cost

A single round (task + plan + 1 executor + 1 critic) costs roughly:

- 3 inference calls on 0G Compute — pricing per model (see `pc.testnet.0g.ai`).
- ~6 storage writes on 0G Log (one per bus event) — fractions of a test 0G per write.

A round that needs revision doubles the cost (2 plans, 2 executions, 2 critiques, plus one `plan.revise` event).

## Known flakes

- **Transient 0G Log upload reverts**: the pinned `@0gfoundation/0g-ts-sdk@1.2.1` occasionally submits to an indexer node advertising an inconsistent storage fee and the tx reverts with `status=0`. This is documented in `docs/dev-log.md`. Retrying (`pnpm --filter @sovereignclaw/example-research-mesh dev` again) routes to a different indexer node and usually succeeds within 1–3 attempts.
- **Critic JSON**: weaker models occasionally produce prose around the JSON. The parser tolerates code fences and surrounding text, but if you see `CritiqueParseError`, bump to a stronger model or add a one-shot example to the critic's system prompt.
