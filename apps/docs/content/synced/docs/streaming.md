# Streaming in `@sovereignclaw/core` and `@sovereignclaw/mesh` (v0.2.0)

Phase B added streaming SSE support to the core inference adapter and a
unified `MeshEvent` surface to the mesh package. The motivation, the wire
format, the public API, and the caveats are below.

## Why streaming

The IncomeClaw demo UX (see `IncomeClaw-Roadmap.md` §1.5) shows agent
"thinking" tokens as they arrive, not as a final blob. That single feature
turns a 30 s wall-of-silence into a live thread the user can read along
with — same model, same time-to-final-answer, dramatically different
perceived latency. Without streaming, the framework is correct but the demo
is dead air.

Streaming is also a prerequisite for any frontend that wants to render
mid-run state: tool-call chips, partial reasoning traces, "agent is
thinking..." indicators. Phase B makes those primitives real instead of
something the IncomeClaw side has to invent.

## 0G Compute Router SSE wire format (pinned)

Each event is a `data: <JSON>\n\n` line. The format observed live during
Phase B kickoff (curl + `qwen/qwen-2.5-7b-instruct`) and frozen as the
parser's input contract:

```
data: {"choices":[{"delta":{"content":"","role":"assistant"},"index":0,"finish_reason":null,"logprobs":null}],"object":"chat.completion.chunk","usage":null,"created":1777806101,"model":"qwen2.5-7b-instruct","id":"chatcmpl-...","system_fingerprint":null}

data: {"choices":[{"delta":{"content":"One"},"index":0,"finish_reason":null,"logprobs":null}],"object":"chat.completion.chunk","usage":null,...}

data: {"choices":[{"delta":{"content":"\n"},"index":0,"finish_reason":null,"logprobs":null}],"object":"chat.completion.chunk","usage":null,...}

data: {"choices":[{"delta":{"content":"\nThree\nFour"},"index":0,"finish_reason":null,"logprobs":null}],"object":"chat.completion.chunk","usage":null,...}

data: {"choices":[{"delta":{"content":""},"finish_reason":"stop","index":0,"logprobs":null}],"object":"chat.completion.chunk","usage":null,...}

data: {"choices":[],"object":"chat.completion.chunk","usage":{"prompt_tokens":21,"completion_tokens":9,"total_tokens":30},"created":...,"model":"qwen2.5-7b-instruct","id":"chatcmpl-...","system_fingerprint":null}

data: {"x_0g_trace":{"request_id":"107cefb0-daaf-4517-b5ec-352bb1e4a6cf","provider":"0xa48f01287233509FD694a22Bf840225062E67836","billing":{"input_cost":"1050000000000","output_cost":"900000000000","total_cost":"1950000000000"},"tee_verified":true}}

data: [DONE]
```

Frame taxonomy the parser implements:

1. **Role-handshake frame** — first frame, empty `delta.content` plus
   `role:"assistant"`. Emit nothing token-side.
2. **Delta-content frames** — `delta.content` carries arbitrary text
   (often **multi-token**, e.g. `"\nThree\nFour"` is one frame). Emit a
   `'token'` chunk only when the string is non-empty.
3. **Stop frame** — `finish_reason: "stop"`, empty `delta.content`. Emit
   nothing.
4. **Usage-only frame** — `choices: []`, `usage: { prompt_tokens, ... }`.
   Capture for the final `'done'` chunk.
5. **Attestation frame** — top-level `x_0g_trace` object, no `choices`.
   Capture `tee_verified`, `provider`, `request_id`, and `billing` for the
   final `'done'` chunk.
6. **Terminal sentinel** — `data: [DONE]`. End of stream; close the
   iterator after emitting `'done'`.

**`tee_verified` IS present in streaming responses.** Phase B confirmed
it lives in the dedicated attestation frame (frame 5 above), not on the
delta frames. The streaming `InferenceResult.attestation.teeVerified`
matches the non-streaming value byte-for-byte.

## `@sovereignclaw/core` streaming API

```ts
import {
  Agent,
  sealed0GInference,
  type InferenceChunk,
  StreamInterruptedError,
} from '@sovereignclaw/core';

const adapter = sealed0GInference({
  model: 'qwen/qwen-2.5-7b-instruct',
  apiKey: process.env.COMPUTE_ROUTER_API_KEY!,
  verifiable: true,
});

// Direct adapter usage:
const result = await adapter.run([{ role: 'user', content: 'count to five' }], {
  stream: true,
  onChunk(chunk: InferenceChunk) {
    if (chunk.type === 'token') process.stdout.write(chunk.text);
    else if (chunk.type === 'done') console.log('\n[done]', chunk.usage);
  },
});
console.log(result.text); // full text
console.log(result.attestation.teeVerified); // true|false|null

// Or via Agent (the typical path):
const agent = new Agent({ role: 'researcher', inference: adapter });
agent.on('agent.thinking.token', ({ text }) => process.stdout.write(text));
agent.on('agent.thinking.end', ({ fullText }) => console.log('\n', fullText));
await agent.run('count to five', { onChunk: () => undefined });
```

Notes:

- `onChunk` is the only "stream this" switch. The rest of the
  `InferenceResult` shape is unchanged from the non-streaming path —
  callers that ignore `onChunk` get the same shape they got in v0.1.x.
- The promise still resolves to the full `InferenceResult` after the
  stream completes. Don't try to parallelize "consume chunks" with
  "await the result" — they happen in lockstep.
- `StreamInterruptedError` is thrown if the stream is malformed,
  truncated mid-stream, or the `onChunk` callback throws. **Mid-stream
  retries are not attempted** — partial state would corrupt the consumer.
  The adapter retries only before the first byte is received (network
  failures, 5xx). Callers who want to resume must restart the request.
- `timeoutMs` applies to the **connection** (first byte), not to the full
  stream duration. A long model response will not accidentally expire.
  For an explicit total-stream cap, supply your own `signal:` and clear
  it via your own timer.
- `verify_tee: true` is sent on every streaming request when
  `verifiable: true` is set on `sealed0GInference` (default).

## `@sovereignclaw/mesh` event surface

```ts
import { Agent } from '@sovereignclaw/core';
import { Mesh, sequentialPattern, type MeshEvent } from '@sovereignclaw/mesh';

const mesh = new Mesh({ meshId: 'demo', provider: someProvider });
mesh.register(brainAgent).register(strategistAgent);

const unsubscribe = mesh.onEvent((event: MeshEvent) => {
  switch (event.type) {
    case 'task.created':
      ui.startTask(event.taskId, event.input);
      break;
    case 'agent.thinking.start':
      ui.openAgentTrace(event.agentRole, event.taskId);
      break;
    case 'agent.thinking.token':
      ui.appendToken(event.agentRole, event.text);
      break;
    case 'agent.thinking.end':
      ui.closeAgentTrace(event.agentRole, event.fullText);
      break;
    case 'agent.action.start':
      ui.showToolChip(event.agentRole, event.tool, event.args);
      break;
    case 'agent.action.end':
      ui.completeToolChip(event.agentRole, event.tool, event.result, event.ms);
      break;
    case 'agent.handoff':
      ui.drawArrow(event.fromRole, event.toRole);
      break;
    case 'agent.outcome':
      ui.markAgentDone(event.agentRole, event.result);
      break;
    case 'task.complete':
      ui.finishTask(event.finalOutput);
      break;
    case 'task.error':
      ui.errorTask(event.error.name, event.error.message);
      break;
  }
});

await mesh.dispatch(
  'Find me one $10K AI consulting deal.',
  sequentialPattern({ agentNames: ['brain', 'strategist'] }),
);

unsubscribe();
```

`mesh.onEvent` is **separate** from `mesh.on` — that latter still
subscribes to the durable bus log (the same source IncomeClaw will use for
audit/replay). `onEvent` is the streaming surface for live UI consumption;
`on` is for durability.

`mesh.dispatch(input, pattern)` is what threads the `taskId`. Agent events
emitted **outside** a `dispatch` call do not surface as `MeshEvent`s — by
design, so callers can run agents directly without polluting the
orchestrator's stream.

## Caveats

- **`onEvent` is ephemeral.** Subscribers that disconnect miss whatever
  fires while they are gone. The 0G Log bus (`mesh.bus`) is the durable
  layer for replay/audit. Don't try to reconstruct UI state from
  `onEvent` alone — read the bus on reconnect.
- **Node 22 single-thread assumption.** The mesh's `AsyncLocalStorage`
  context that threads `taskId` through agent events relies on Node's
  single-threaded async hooks. Worker-thread agents would need explicit
  taskId propagation; we don't do that today.
- **`timeoutMs` applies to the connection, not full stream duration.**
  See above. If you want a total cap, use `signal:` and your own timer.
- **No mid-stream retries.** A network blip after the first chunk
  arrives is final — the adapter throws `StreamInterruptedError` and the
  caller restarts.
- **Reflection + streaming don't compose.** Streaming runs the initial
  inference. The reflection sub-loop calls the adapter again for the
  critique step, which uses the regular non-streaming adapter (the
  reflection rubric wants a single concrete output to score, not a token
  stream). If you need reflection on the streamed output, persist the
  full text from the `agent.thinking.end` event and run reflection
  separately downstream.
- **A buggy `MeshEvent` subscriber cannot take down the dispatch.**
  Subscriber exceptions are swallowed; sibling subscribers continue to
  receive events. Subscribers own their own `try/catch` for things they
  care about.

## Reference consumer

[IncomeClaw](https://github.com/lalla-ai/incomeclaw) is the production
consumer of these APIs. See `incomeclaw/agents/*` for typical usage and
`incomeclaw/apps/web/lib/sse.ts` for the wire-up between `mesh.onEvent`
and a frontend EventSource stream.
