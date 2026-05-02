---
'sovereignclaw': minor
---

Phase 2: AgentNFT and MemoryRevocation contracts on 0G Galileo testnet.

- ERC-7857-style iNFT lifecycle: `mint`, `transferWithReencryption`,
  `revoke`, `recordUsage`, `authorizeUsage`, `setOracle`. Standard ERC-721
  transfer / approve / operator paths disabled — every ownership change
  must go through the oracle re-encryption gate.
- EIP-712 typed-data oracle proofs with per-token monotonic nonces and an
  `OracleAction` discriminator (Transfer | Revoke) preventing
  action-confusion replay.
- `MemoryRevocation` registry: public, queryable, only the bound AgentNFT
  may write. Binding is set at deploy and immutable.
- Slot-packed `Agent` struct (bytes32, bytes32, dynamic bytes, packed
  uint64/uint16/bool, dynamic string).
- 75 Foundry tests across 5 suites (54 AgentNFT + 11 MemoryRevocation +
  6 fuzz + 2 invariants × 128k calls each + 1 deploy-script + 1 Ping
  legacy). Gas snapshot committed and CI-gated.
- Deploy script with CREATE-address prediction so the registry can bind
  to AgentNFT immutably in one broadcast. TS wrappers
  (`deploy-contracts`, `verify-contracts`, `check-deployment`) round-trip
  the broadcast JSON into `deployments/0g-testnet.json`.
- Live on 0G Galileo testnet (chainId 16602):
  - AgentNFT `0xc3f997545da4AA8E70C82Aab82ECB48722740601`
  - MemoryRevocation `0x735084C861E64923576D04d678bA2f89f6fbb6AC`
- Source verification on chainscan-galileo currently manual via the
  explorer UI; flattened sources committed under `deployments/flattened/`
  and instructions in `contracts/README.md`.
