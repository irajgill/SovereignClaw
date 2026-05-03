# @sovereignclaw/core

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
  - @sovereignclaw/memory@0.1.0
