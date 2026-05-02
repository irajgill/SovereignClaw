# contracts/

Foundry project for SovereignClaw smart contracts.

## Phase 0 status

Contains only `Ping.sol`, a throwaway used by the smoke test to verify the
deploy/call/event pipeline works against 0G Galileo testnet. Replaced in Phase 2
by `AgentNFT.sol` and `MemoryRevocation.sol`.

## Commands

```bash
# from repo root
pnpm contracts:build
pnpm contracts:test
```

## First-time setup

After cloning:

```bash
cd contracts
forge install foundry-rs/forge-std --no-git
```
