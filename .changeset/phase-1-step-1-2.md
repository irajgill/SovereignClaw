---
'@sovereignclaw/core': minor
'@sovereignclaw/memory': minor
---

Phase 1 Step 1.2: memory v0 — InMemory, OG_Log, encrypted, deriveKekFromSigner

- New typed errors hierarchy under `MemoryError`
- `MemoryProvider` interface with KV-style semantics on append-only stores
- `InMemory()` adapter for tests
- `OG_Log()` adapter backed by `@0gfoundation/0g-ts-sdk@1.2.1` against 0G Galileo testnet
- `encrypted()` wrapper composing AES-256-GCM with any inner provider
- `deriveKekFromSigner()` — deterministic wallet-derived KEKs per (wallet, namespace) pair
- 48 unit tests (no network), 3 integration tests against real testnet
