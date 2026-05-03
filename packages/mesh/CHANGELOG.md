# @sovereignclaw/mesh

## 0.2.0

### Minor Changes

- Add per-agent `MeshEvent` surface (`onEvent` API, `agent.thinking.*`,
  `agent.action.*`, `agent.handoff`, `task.*` events) for real-time
  streaming to orchestrator and frontend.

  `Mesh.onEvent(handler)` is the new ephemeral pub/sub channel that
  re-emits agent-level events from registered agents (the
  `agent.thinking.*` / `agent.action.*` / `agent.outcome` events added in
  `@sovereignclaw/core@0.2.0`) tagged with a per-task `taskId`. The
  durable bus surface (`mesh.on` / `mesh.bus`) is unchanged — both
  coexist; `onEvent` is for live UI consumption, `bus` is for replay.

  `Mesh.dispatch(input, pattern)` is the opinionated runner that scopes a
  `taskId` over the pattern's execution via `AsyncLocalStorage`, and
  emits `task.created` / `task.complete` / `task.error`. Agent events
  emitted outside a `dispatch` call do **not** surface as `MeshEvent`s by
  design — direct `agent.run()` calls don't pollute the orchestrator
  stream.

  Handoffs are detected automatically: when an agent emits
  `agent.thinking.start` and the previous agent in the same task was a
  different role, an `agent.handoff` event fires before the new
  `agent.thinking.start`.

  New helpers:

  - `sequentialPattern({ agentNames })` — minimal walker pattern useful
    for tests and simple chains.
  - `MeshEvent` discriminated union, `MeshEventHandler`, `MeshEventType`
    exported from the package entry.

  Subscriber errors are swallowed at the emit point — a buggy listener
  cannot take down a sibling listener or the active dispatch.

  Tests:

  - 6 new unit tests for `mesh-events.test.ts` covering MeshEvent
    ordering, unsubscribe, error propagation, buggy-subscriber isolation,
    and the "no leakage outside dispatch" rule.
  - 1 integration test against the live 0G Router asserting ≥5
    thinking-token events per agent, exactly one `agent.handoff` between
    brain → strategist, and consistent `taskId` across all 28 emitted
    events.
  - All 30 prior unit tests pass without modification.

  See `docs/streaming.md` for the full event vocabulary, examples, and
  caveats.

### Patch Changes

- Updated dependencies
  - @sovereignclaw/core@0.2.0

## 0.1.0

### Minor Changes

- v0.1.0 — first public release. Sovereign memory, agent runtime, mesh, iNFT lifecycle, reflection. APIs stable. See docs/architecture.md for the full story.

  This release publishes the five SovereignClaw libraries to npm under the `@sovereignclaw/*` scope:

  - `@sovereignclaw/memory` — `MemoryProvider` interface, `OG_Log`, `InMemory`, `encrypted()` wrapper, `deriveKekFromSigner` (AES-256-GCM, HKDF-SHA-256, EIP-191 wallet-derived KEK).
  - `@sovereignclaw/core` — `Agent` runtime, `sealed0GInference` adapter wired to the 0G Compute Router with `verify_tee=true`, tool runtime, lifecycle hooks, `listRecentLearnings`.
  - `@sovereignclaw/inft` — `mintAgentNFT`, `transferAgentNFT`, `revokeMemory`, `recordUsage`, `OracleClient`, `loadDeployment`. Bundles the deployed `AgentNFT` and `MemoryRevocation` ABIs and the EIP-712 typehash fixture so consumers get byte-equal proofs without cloning the workspace.
  - `@sovereignclaw/mesh` — `Mesh` orchestrator, append-only bus on 0G Log, typed events, `planExecuteCritique` pattern with replay/recovery.
  - `@sovereignclaw/reflection` — `reflectOnOutput()`, four built-in rubrics, custom-rubric support, learnings persisted to history namespace.

  Apache-2.0. Built and verified against 0G Galileo testnet (chainId 16602).

### Patch Changes

- Updated dependencies
  - @sovereignclaw/core@0.1.0
  - @sovereignclaw/memory@0.1.0
