# @sovereignclaw/inft

ERC-7857-style iNFT lifecycle helpers for SovereignClaw. Wraps the deployed
`AgentNFT` and `MemoryRevocation` contracts on 0G Galileo testnet.

```bash
pnpm add @sovereignclaw/inft ethers @sovereignclaw/memory
```

## Mint

```ts
import { Wallet, JsonRpcProvider } from 'ethers';
import { mintAgentNFT, loadDeployment } from '@sovereignclaw/inft';

const provider = new JsonRpcProvider(process.env.RPC_URL);
const owner = new Wallet(process.env.PRIVATE_KEY!, provider);
const deployment = loadDeployment();

const minted = await mintAgentNFT({
  agent: { role: 'researcher', getPointer: () => agent.getPointer() },
  owner,
  royaltyBps: 500,
  deployment,
});
console.log(minted.explorerUrl);
```

## Transfer with re-encryption

```ts
import { transferAgentNFT, OracleClient } from '@sovereignclaw/inft';

const oracle = new OracleClient({ url: 'http://localhost:8787' });
const tx = await transferAgentNFT({
  tokenId,
  from: alice,
  to: bob.address,
  newOwnerPubkey: bob.signingKey.publicKey,
  oracle,
  deployment,
});
console.log(tx.explorerUrl);
```

## Revoke (irreversible)

```ts
import { revokeMemory } from '@sovereignclaw/inft';

const result = await revokeMemory({ tokenId, owner: bob, oracle, deployment });
console.log(result.explorerUrl);
// After this: on-chain wrappedDEK is zeroed, AgentNFT.revoked = true,
// MemoryRevocation.isRevoked(tokenId) = true. Oracle returns 410 on any
// future /oracle/reencrypt for this tokenId. There is no undo.
```

## Record usage (royalty event)

```ts
import { recordUsage } from '@sovereignclaw/inft';

await recordUsage({ tokenId, payer: '0x...', amount: 1_000_000n, signer: owner, deployment });
```

## Errors

All operations throw typed errors. Catch by class:

- `MintError`, `TransferError`, `RevokeError`, `RecordUsageError`
- `OracleClientError` and its subclasses: `OracleAuthError` (401),
  `OracleRevokedError` (410), `OracleHttpError` (other 4xx/5xx),
  `OracleTimeoutError`, `OracleUnreachableError`
- `ContractRevertError` (revert from `AgentNFT` / `MemoryRevocation`)
- `DeploymentNotFoundError`

## EIP-712 details

The package exports the typehash constants the contract uses:

- `ORACLE_PROOF_TYPEHASH`, `DOMAIN_TYPEHASH`, `DOMAIN_NAME_HASH`, `DOMAIN_VERSION_HASH`
- `digestForOracleProof(chainId, verifyingContract, fields)` — byte-identical
  to `AgentNFT._verifyOracleProof`'s reconstruction.
- `encodeOracleProof(fields, signature)` — the wire format the contract decodes.

The TS-side hashes are checked against a Foundry-emitted fixture
(`deployments/eip712-typehashes.json`) on every test run; drift fails CI.

## Layering

Depends only on `@sovereignclaw/memory` (for the `Pointer` type) and `ethers`.
Does not depend on `@sovereignclaw/core`. Per working agreement §19.5.

## Examples

See [examples/agent-mint-transfer-revoke](../../examples/agent-mint-transfer-revoke/)
for an end-to-end mint → transfer → revoke flow against real 0G testnet.
