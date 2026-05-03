# @sovereignclaw/core

Agent runtime for SovereignClaw. Provides the `Agent` class, the
`sealed0GInference` adapter (TEE-verified chat completions through the 0G
Compute Router), pluggable tool/memory/reflection hooks, and typed events
for the whole run lifecycle.

## Install

```bash
pnpm add @sovereignclaw/core @sovereignclaw/memory ethers
```

## 10-line quickstart

```typescript
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';

const agent = new Agent({
  role: 'researcher',
  systemPrompt: 'You are a careful researcher.',
  inference: sealed0GInference({
    model: 'qwen/qwen-2.5-7b-instruct',
    apiKey: process.env.COMPUTE_ROUTER_API_KEY!,
    baseUrl: process.env.COMPUTE_ROUTER_BASE_URL!,
    verifiable: true,
  }),
  memory: InMemory({ namespace: 'quickstart' }),
});
const out = await agent.run('What year was the Transformer paper published?');
console.log(out?.text, out?.attestation?.teeVerified);
await agent.close();
```

## API

| Export                     | Kind      | Purpose                                                                                    |
| -------------------------- | --------- | ------------------------------------------------------------------------------------------ |
| `Agent`                    | class     | Runtime. Wires inference + memory + tools + reflection; emits events.                      |
| `AgentConfig`              | type      | `role`, `systemPrompt`, `inference`, `memory?`, `tools?`, `reflect?`.                      |
| `sealed0GInference(opts)`  | fn        | Inference adapter for the 0G Compute Router with `verify_tee`.                             |
| `InferenceAdapter`         | interface | `complete({ messages, options })` → `{ text, attestation, billing }`.                      |
| `defineTool / executeTool` | fn        | Small tool DSL with Zod validation, timeout, and typed errors.                             |
| `httpRequestTool`          | tool      | Built-in safe-fetch tool for agents that need HTTP.                                        |
| `listRecentLearnings`      | fn        | Pull the N most recent reflection learnings from a `MemoryProvider`.                       |
| `LEARNING_PREFIX`          | const     | Key prefix used when reflection persists learning records.                                 |
| `ReflectionConfig`         | interface | Structural contract for the `reflect` hook — satisfied by `@sovereignclaw/reflection`.     |
| `AgentEvents`              | type map  | Typed lifecycle events: `agent.start`, `tool.*`, `reflect.*`, `agent.done`, `agent.error`. |

## Errors

All extend `CoreError`:

| Error                                   | When                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `RouterAuthError`                       | 0G Router 401/403 (bad `COMPUTE_ROUTER_API_KEY`).               |
| `RouterBalanceError`                    | 0G Router 402 (no compute credits).                             |
| `RouterClientError`                     | Router 4xx not covered by auth/balance.                         |
| `RouterServerError`                     | Router 5xx.                                                     |
| `InferenceTimeoutError`                 | Request exceeded the configured timeout.                        |
| `EmptyInferenceResponseError`           | Router returned 200 but no choices/content.                     |
| `DirectModeUnsupportedError`            | `sealed0GInference` called without a provider that supports it. |
| `ToolValidationError`                   | Tool input failed its Zod schema.                               |
| `ToolExecutionError / ToolTimeoutError` | Tool implementation threw or hung.                              |
| `AgentClosedError`                      | `agent.run()` after `agent.close()`.                            |

## Events

Subscribe with `agent.on(name, handler)`:

- `agent.start / agent.done / agent.error`
- `inference.start / inference.complete`
- `tool.start / tool.complete / tool.error`
- `reflect.start / reflect.complete` (only fire when a `reflect` adapter is configured)

## Further reading

- [`docs/architecture.md`](../../docs/architecture.md) — layered diagram + trust model.
- [`docs/benchmarks.md`](../../docs/benchmarks.md) — cold / warm inference RTT.
- [`examples/research-claw`](../../examples/research-claw) — single-agent DoD demo.

## License

MIT — see the repo root.
