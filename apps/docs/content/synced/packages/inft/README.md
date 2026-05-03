# @sovereignclaw/inft

ERC-7857 iNFT lifecycle helpers for SovereignClaw — mint an agent as a
token, transfer with oracle-mediated re-encryption, record usage events,
and irrevocably revoke memory access. Wraps the deployed `AgentNFT` and
`MemoryRevocation` contracts on 0G Galileo testnet.

## Install

```bash
pnpm add @sovereignclaw/inft @sovereignclaw/memory ethers
```

The package imports ABIs from `contracts/out/`. Run `forge build` in
`contracts/` once before building this package — the quickstart covers this.

## 10-line quickstart

```typescript
import { Wallet, JsonRpcProvider, randomBytes } from 'ethers';
import { loadDeployment, mintAgentNFT, revokeMemory, OracleClient } from '@sovereignclaw/inft';

const signer = new Wallet(process.env.PRIVATE_KEY!, new JsonRpcProvider(process.env.RPC_URL!));
const deployment = loadDeployment();
const oracle = new OracleClient({ url: 'http://localhost:8787' });

const minted = await mintAgentNFT({
  agent: { role: 'researcher', getPointer: () => process.env.MEMORY_POINTER! },
  owner: signer,
  wrappedDEK: randomBytes(32),
  deployment,
});
await revokeMemory({ tokenId: minted.tokenId, owner: signer, oracle, deployment });
```

## API

| Export                               | Kind  | Purpose                                                            |
| ------------------------------------ | ----- | ------------------------------------------------------------------ |
| `mintAgentNFT`                       | fn    | Mints one iNFT. Commits pointer + wrappedDEK + metadata hash.      |
| `transferAgentNFT`                   | fn    | Transfers via oracle re-encryption; updates wrappedDEK atomically. |
| `revokeMemory`                       | fn    | Owner signs → oracle registry → chain revoke. Irreversible.        |
| `recordUsage`                        | fn    | Append a typed usage record for downstream analytics.              |
| `OracleClient`                       | class | HTTP client for `/oracle/{pubkey,reencrypt,revoke,prove,healthz}`. |
| `loadDeployment`                     | fn    | Reads `deployments/0g-testnet.json`. Throws if missing.            |
| `AgentNFTAbi / MemoryRevocationAbi`  | const | Ethers-v6-compatible ABIs. Used internally; exposed for callers.   |
| `explorerTxUrl / explorerAddressUrl` | fn    | Format chainscan links for mint/transfer/revoke receipts.          |
| `digestForOracleProof` etc.          | fn    | EIP-712 helpers — used by the oracle; exposed for audit tests.     |
| `CONTRACT_LIMITS`                    | const | On-chain field maxima (role/pointer/DEK byte lengths).             |

## Errors

All extend `InftError`:

| Error                                         | When                                                                  |
| --------------------------------------------- | --------------------------------------------------------------------- |
| `MintError`                                   | Pre-flight validation failed or mint tx reverted.                     |
| `TransferError`                               | Oracle rejected, chain reverted, or post-condition assertion failed.  |
| `RevokeError`                                 | Oracle rejected, chain reverted, or post-condition assertion failed.  |
| `RecordUsageError`                            | Usage tx reverted or over field-length limit.                         |
| `OracleClientError`                           | Generic oracle transport error (parent).                              |
| `OracleAuthError`                             | 401/403 from oracle (auth token mismatch).                            |
| `OracleRevokedError`                          | 410 from oracle — token is already revoked.                           |
| `OracleHttpError`                             | Any other 4xx/5xx from oracle.                                        |
| `OracleTimeoutError / OracleUnreachableError` | Request timed out / couldn’t reach oracle.                            |
| `ContractRevertError`                         | Parsed reason from a contract revert (wraps the underlying tx error). |
| `DeploymentNotFoundError`                     | `deployments/0g-testnet.json` missing or malformed.                   |

## Trust model

- The oracle holds one EIP-712 signing key and is **the only entity that
  can approve a transfer or a revoke**. On-chain, `AgentNFT` checks the
  oracle signature before touching the wrappedDEK or the revoked bit.
- `revokeMemory` is irreversible: the oracle flips its in-memory registry
  **before** returning the proof, so any concurrent `/oracle/reencrypt`
  for the same token 410s. The chain then permanently zeroes the DEK.
- A misbehaving oracle cannot mint or transfer to someone else — those
  require the owner’s signature as well, enforced on-chain.

## Further reading

- [`contracts/README.md`](../../contracts/README.md) — Solidity sources + fuzz tests.
- [`apps/backend/README.md`](../../apps/backend/README.md) — the dev oracle implementation.
- [`docs/benchmarks.md`](../../docs/benchmarks.md) — revocation latency on Galileo.
- [`examples/agent-mint-transfer-revoke`](../../examples/agent-mint-transfer-revoke) — end-to-end lifecycle demo.

## License

MIT — see the repo root.
