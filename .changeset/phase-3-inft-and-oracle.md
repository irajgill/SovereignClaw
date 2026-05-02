---
'@sovereignclaw/inft': minor
'@sovereignclaw/backend': minor
'sovereignclaw': minor
---

Phase 3: dev oracle + iNFT lifecycle on 0G Galileo testnet.

- New package **`@sovereignclaw/inft`**: `mintAgentNFT`, `transferAgentNFT`,
  `revokeMemory`, `recordUsage`, `OracleClient`, `loadDeployment`. Pure
  ethers + JSON ABIs from `contracts/out/`. Zero `@sovereignclaw/core` dep
  (per §19.5). Typed errors only (`MintError`, `TransferError`, `RevokeError`,
  `OracleClientError` and 5 subclasses, `ContractRevertError`,
  `DeploymentNotFoundError`).
- New app **`@sovereignclaw/backend`** (Hono, Node 22): four oracle
  endpoints (`/oracle/pubkey`, `/oracle/prove`, `/oracle/reencrypt`,
  `/oracle/revoke`) plus `/healthz`. Optional bearer auth. EIP-712
  signing matches the on-chain `_verifyOracleProof` byte-for-byte.
  Dockerfile + docker-compose for local dev.
- **EIP-712 byte-equality fixture**: `contracts/test/EmitTypeHashes.t.sol`
  emits `deployments/eip712-typehashes.json`; off-chain TS in both
  `@sovereignclaw/inft` and `@sovereignclaw/backend` re-derives the four
  typehashes locally and asserts equality.
- **`scripts/gen-oracle-key.ts`** + **`scripts/rotate-oracle.ts`**:
  generate dev-oracle keypair and rotate `AgentNFT.oracle` via `setOracle`,
  with append-only `oracleHistory` in the deployment record.
- **Live oracle rotation** completed: `AgentNFT.oracle` now points to a
  fresh secp256k1 keypair held by `apps/backend`. Tx
  `0x1350215cc6b521ac6a8d085a0bab1bb5ab1faded5931701b59886c124077aee1`.
- **`examples/agent-mint-transfer-revoke`**: Phase 3 DoD example. Mint as
  Alice → transfer to Bob via oracle re-encryption → revoke as Bob,
  end-to-end on real 0G Galileo testnet. Asserts on-chain state at every
  step. Five consecutive runs with no flake.
- **`docs/security.md` v1**: trust boundaries, honest revocation crypto
  semantics, defense-in-depth hierarchy, Phase 3-vs-production gap list.
- **CI**: new `inft-lifecycle` job in `.github/workflows/integration.yml`
  that boots the dev oracle and runs `pnpm --filter @sovereignclaw/inft
test:integration` against testnet on the `run-integration` PR label.
- 33 `@sovereignclaw/inft` unit tests + 2 integration tests.
- 16 `@sovereignclaw/backend` unit tests.
- 76 Foundry tests (Phase 2's 75 + 1 typehash emitter), all green; gas
  snapshot still passes the CI regression gate.
- `pnpm check:deployment`: 9/9 (or 10/10 with `ORACLE_ADDRESS` env set).
