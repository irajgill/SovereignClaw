# @sovereignclaw/core

## 0.2.0

### Minor Changes

- Add streaming inference support (`sealed0GInference stream:true`, `Agent`
  `onChunk` callback, `InferenceChunk` type, `StreamInterruptedError`,
  per-agent event emissions).

  The non-streaming code path is unchanged — same wire format, same
  response shape, same retry semantics. Setting `stream: true` on
  `InferenceAdapter.run()` opts in to SSE streaming against the 0G
  Compute Router; tokens flow through the user-supplied `onChunk` callback
  in real time, and the promise still resolves to a complete
  `InferenceResult` (with `attestation.teeVerified` matching the
  non-streaming value).

  The `Agent` class accepts an `onChunk` per-call option and emits the new
  typed events `agent.thinking.start`, `agent.thinking.token`,
  `agent.thinking.end`, `agent.action.start`, `agent.action.end`, and
  `agent.outcome` so consumers (`@sovereignclaw/mesh@0.2.0`) can re-emit
  them on a unified surface.

  `StreamInterruptedError` extends `InferenceError` and is thrown on
  malformed SSE, mid-stream truncation, or `onChunk` callbacks that throw.
  Mid-stream retries are intentionally not attempted (per §19.7). The
  adapter still retries before the first byte for transient network /
  5xx failures.

  Connection-only timeout: `timeoutMs` applies to first-byte arrival, not
  full stream duration. Callers wanting a total-stream cap should pass
  their own `AbortSignal` via the new `signal:` option.

  Public surface additions: `RunOptions` (now includes `stream`,
  `onChunk`, `signal`), `StreamRunOptions` (streaming-required variant),
  `InferenceChunk` discriminated union, `parseSSEStream`, `TokenUsage`
  type extracted from the inline shape on `InferenceResult.usage`.

  Tests:

  - 8 new unit tests for the SSE parser exercising token boundaries, TCP
    fragmentation, comments, malformed JSON, missing terminal sentinel,
    CRLF tolerance, and attestation-without-teeVerified.
  - 1 integration test against the live 0G Router (`qwen/qwen-2.5-7b-instruct`)
    asserting ≥10 token chunks, final text equals concatenation, and the
    attestation surfaces with `teeVerified: true` on a real provider
    (`0xa48f01287233509FD694a22Bf840225062E67836`).
  - All 60 prior unit tests pass without modification.

  See `docs/streaming.md` for the full wire-format spec, API examples, and
  caveats.

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
