# @sovereignclaw/mesh

Multi-agent coordination for SovereignClaw. One **Bus** (append-only
event log over any `MemoryProvider`), one **Mesh** (Bus + agent registry),
and `planExecuteCritique`, the default planner → executor → critic
orchestration pattern. Everything the agents say to each other is a typed,
sequenced, optionally-encrypted event on the log.

## Install

```bash
pnpm add @sovereignclaw/mesh @sovereignclaw/core @sovereignclaw/memory
```

## 10-line quickstart

```typescript
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';
import { Mesh, planExecuteCritique } from '@sovereignclaw/mesh';

const inf = () =>
  sealed0GInference({
    /* model, apiKey, baseUrl, verifiable: true */
  });
const mesh = new Mesh({ meshId: 'm1', provider: InMemory({ namespace: 'm1-bus' }) });
mesh
  .register(new Agent({ role: 'planner', systemPrompt: 'You plan.', inference: inf() }))
  .register(new Agent({ role: 'executor', systemPrompt: 'You execute.', inference: inf() }))
  .register(new Agent({ role: 'critic', systemPrompt: 'JSON only.', inference: inf() }));
const r = await planExecuteCritique({
  mesh,
  planner: mesh.get('planner')!,
  executors: [mesh.get('executor')!],
  critic: mesh.get('critic')!,
  task: 'Name the Transformer authors. One sentence.',
  maxRounds: 2,
  acceptThreshold: 0.7,
});
```

## API

| Export                      | Kind  | Purpose                                                                                                  |
| --------------------------- | ----- | -------------------------------------------------------------------------------------------------------- |
| `Bus`                       | class | Append-only log: `append(event)`, `replay(fromSeq?)`, `on(handler)`. Thin wrapper on a `MemoryProvider`. |
| `Mesh`                      | class | `Bus` + agent registry. `register / get / on / close`.                                                   |
| `planExecuteCritique(opts)` | fn    | Planner → executor(s) → critic loop with acceptance threshold.                                           |
| `BusEvent<P>`               | type  | `{ type, fromAgent, seq, timestamp, parentSeq?, meshId, payload }`.                                      |
| `BusEventTypes`             | enum  | `TaskCreated / PlanCreated / ExecutionStarted / ExecutionComplete / CritiqueCreated / TaskComplete`.     |
| `SeqCounter`                | class | Monotonic sequence generator. Used by `Bus` internally.                                                  |
| `eventKey / seqFromKey`     | fn    | Canonical, lex-sortable key encoding for bus events.                                                     |

## Errors

All extend `MeshError`:

| Error                    | When                                                        |
| ------------------------ | ----------------------------------------------------------- |
| `BusAppendError`         | Underlying provider `set` failed.                           |
| `BusReplayError`         | Underlying provider `list` or `get` failed.                 |
| `MeshClosedError`        | Operation after `mesh.close()`.                             |
| `PatternError`           | Parent class for pattern-specific failures.                 |
| `EmptyAgentOutputError`  | An agent returned null/empty text during the pattern.       |
| `MaxRoundsExceededError` | `planExecuteCritique` ran out of rounds without acceptance. |
| `CritiqueParseError`     | Critic output did not parse to `{score, accept, ...}`.      |

## Bus guarantees

- **Single-writer ordering.** Inside one `Mesh` instance, sequence
  numbers are strictly monotonic. Cross-process replay with fan-in
  writers is explicitly deferred — see `docs/dev-log.md` Phase 5 notes.
- **Encryption-agnostic.** The bus stores raw bytes; wrap the provider
  with `encrypted(...)` and the whole log is AES-GCM-sealed to a KEK
  derived from an EOA signer.
- **Deterministic replay.** `replay()` returns events in seq order with
  stable keys so tests and audits can diff the log across runs.

## Patterns

`planExecuteCritique` is the one shipped v0 pattern. Debate and
hierarchical patterns are deferred to a future phase — see `docs/dev-log.md`.
You can build your own pattern by composing `mesh.bus.append(...)` and
`agent.run(...)` directly; there is nothing privileged about
`planExecuteCritique`.

## Further reading

- [`examples/research-mesh`](../../examples/research-mesh) — 3-agent DoD demo with an encrypted 0G Log bus.
- [`docs/benchmarks.md`](../../docs/benchmarks.md) — tasks/second on Galileo + free router.
- [`docs/architecture.md`](../../docs/architecture.md) — how Bus, Mesh and agents fit in the layered stack.

## License

MIT — see the repo root.
