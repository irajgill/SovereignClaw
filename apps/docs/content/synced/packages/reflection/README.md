# @sovereignclaw/reflection

Self-critique and learning persistence for SovereignClaw agents. Drop-in
`reflect` hook for `@sovereignclaw/core` that critiques an agent’s
output, optionally revises it, and — when configured — writes a
durable learning record back to the agent’s own memory so the next run
can learn from it.

## Install

```bash
pnpm add @sovereignclaw/reflection @sovereignclaw/core
```

## 10-line quickstart

```typescript
import { Agent } from '@sovereignclaw/core';
import { reflectOnOutput } from '@sovereignclaw/reflection';

const agent = new Agent({
  role: 'researcher',
  systemPrompt: 'You are careful.',
  inference: /* sealed0GInference(...) */,
  memory: /* encrypted(OG_Log(...), { kek }) */,
  reflect: reflectOnOutput({
    rounds: 1,           // one critic pass (default)
    critic: 'self',      // reuse the agent's own inference
    rubric: 'accuracy',  // built-in rubric; also 'completeness', 'safety', 'concision'
    persistLearnings: true,
    threshold: 0.7,      // accept above this; revise below
  }),
});
```

## API

| Export                                       | Kind  | Purpose                                                                     |
| -------------------------------------------- | ----- | --------------------------------------------------------------------------- |
| `reflectOnOutput(opts)`                      | fn    | Builds a `ReflectionConfig` compatible with `Agent.reflect`.                |
| `ReflectOnOutputOptions`                     | type  | `rounds`, `critic`, `rubric`, `persistLearnings`, `threshold`.              |
| `parseCritique(raw)`                         | fn    | Robustly extract `{ score, accept, reason }` from a critic’s JSON.          |
| `buildBuiltInRubricPrompt`                   | fn    | Compose a prompt for one of the four built-in rubrics.                      |
| `buildCustomRubricPrompt`                    | fn    | Compose a prompt for a caller-defined rubric.                               |
| `persistLearning({ memory, record })`        | fn    | Write a `LearningRecordV1` under `LEARNING_PREFIX` on any `MemoryProvider`. |
| `learningKey(timestamp, suffix)`             | fn    | Canonical key for a learning record.                                        |
| `CRITIC_SYSTEM_PROMPT / CRITIC_OUTPUT_SHAPE` | const | The prompt contract the critic is held to.                                  |
| `BuiltInRubric / CustomRubric`               | type  | `'accuracy' \| 'completeness' \| 'safety' \| 'concision'` or a callback.    |
| `LearningRecordV1`                           | type  | Durable shape written back into agent memory.                               |

## Errors

All extend `ReflectionError`:

| Error                          | When                                                              |
| ------------------------------ | ----------------------------------------------------------------- |
| `CritiqueParseError`           | Critic output didn’t parse to the required JSON shape.            |
| `InvalidReflectionConfigError` | Caller passed `threshold` out of `[0, 1]` / unknown critic / etc. |
| `LearningPersistError`         | Memory provider rejected the learning write.                      |

## How it works

1. Agent runs, produces output.
2. `reflect.run({ output, input, agent, memory })` kicks off:
   - Critic inference with the rubric-specific prompt.
   - `parseCritique` extracts `{ score, accept, reason }`.
   - If `score < threshold`, a revision inference is run using the
     critic’s suggestion; this loop runs up to `rounds` times.
3. If `persistLearnings` is on, the final record (task, output, score,
   reason) is written to memory under `LEARNING_PREFIX`. The next run
   of the same agent loads recent learnings via `listRecentLearnings`
   from `@sovereignclaw/core` and includes them in the system prompt.

This is an **acyclic** integration: `@sovereignclaw/core` only depends
on the `ReflectionConfig` **interface** (declared in core itself); the
concrete `reflectOnOutput` implementation lives here and imports core.
You can substitute your own reflection by satisfying `ReflectionConfig`.

## Further reading

- [`examples/research-claw`](../../examples/research-claw) — Phase 6 DoD demo with reflection on.
- [`docs/architecture.md`](../../docs/architecture.md) — reflection’s place in the agent loop.
- [`docs/dev-log.md`](../../docs/dev-log.md) — Phase 6 design decisions.

## License

MIT — see the repo root.
