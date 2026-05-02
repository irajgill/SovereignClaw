---
'@sovereignclaw/core': minor
'@sovereignclaw/memory': minor
---

Phase 1 Step 1.3: core v0 — Agent class, sealed0GInference, Tool runtime; agent-hello example

- `Agent` class composing inference + memory + history + tools + lifecycle hooks
- `sealed0GInference` adapter with typed Attestation (teeVerified, providerAddress, requestId)
  and BillingInfo (input/output/total cost as bigint wei) sourced from x_0g_trace
- `defineTool`, `executeTool`, `httpRequestTool` built-in
- Typed event emitter (run.start, run.complete, run.error, tool.call, tool.result)
- Typed errors: CoreError, InferenceError + 6 subtypes, ToolError + 3 subtypes
- examples/agent-hello — end-to-end Phase 1 DoD example, runs against real 0G testnet