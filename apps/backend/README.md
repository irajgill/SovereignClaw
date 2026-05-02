# @sovereignclaw/backend (dev oracle)

Hono on Node 22. Phase 3 surface: the SovereignClaw dev oracle that signs
EIP-712 typed-data proofs the on-chain `AgentNFT` contract verifies. Phase 7
will add the studio deploy routes; the structure leaves room.

## Endpoints

All mutating endpoints accept JSON. If `ORACLE_AUTH_TOKEN` is set in the
environment, every request must carry `Authorization: Bearer <token>`.

| Method | Path                | Body                                                         | Returns                                                          |
| ------ | ------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| `GET`  | `/healthz`          | —                                                            | `{ ok, oracleAddress, hasKey, chainId, agentNFT, revokedCount }` |
| `GET`  | `/oracle/pubkey`    | —                                                            | `{ address, chainId, agentNFT }`                                 |
| `POST` | `/oracle/prove`     | `{ action, tokenId, from, to, newPointer, dataHash, nonce }` | `{ proof }` (ABI-encoded `OracleProof`)                          |
| `POST` | `/oracle/reencrypt` | `{ tokenId, currentOwner, newOwner, newOwnerPubkey }`        | `{ newPointer, newWrappedDEK, proof }` (HTTP 410 if revoked)     |
| `POST` | `/oracle/revoke`    | `{ tokenId, owner, ownerSig, oldKeyHash }`                   | `{ proof }`                                                      |

`ownerSig` is an EIP-191 signature over `SovereignClaw revocation v1\nTokenId: <id>`.

## Environment

| Var                  | Default                            | Required | Notes                                                                              |
| -------------------- | ---------------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `ORACLE_PRIVATE_KEY` | —                                  | yes      | secp256k1, 0x + 64 hex chars. Derive with `pnpm gen:oracle-key`. **Never commit.** |
| `ORACLE_AUTH_TOKEN`  | —                                  | no       | If set, requests must include `Authorization: Bearer <token>`.                     |
| `PORT`               | `8787`                             | no       |                                                                                    |
| `RPC_URL`            | `https://evmrpc-testnet.0g.ai`     | no       | Used to read on-chain owner / nonce / revoked flag.                                |
| `DEPLOYMENT_PATH`    | repo `deployments/0g-testnet.json` | no       | Override for non-default deploy records.                                           |
| `LOG_LEVEL`          | `info`                             | no       | `trace` ... `fatal`.                                                               |

## Run locally

```bash
# from repo root
pnpm --filter @sovereignclaw/backend dev
# or
docker compose -f apps/backend/docker-compose.yml --env-file .env up --build
```

`docker compose up` exposes :8787 with health-checked container. Verify:

```bash
curl localhost:8787/healthz
# {"ok":true,"oracleAddress":"0x...","hasKey":true,"chainId":16602,...}
```

## Phase 3 placeholder re-encryption

`/oracle/reencrypt` currently passes the on-chain `wrappedDEK` bytes through
unchanged when re-issuing for the new owner. Production replaces this with
**TEE-attested ECIES re-encryption** under the new owner's pubkey. The
endpoint shape is final; only the inner crypto changes.

The README of the example app (`examples/agent-mint-transfer-revoke`)
calls this out and so does `docs/security.md`.

## Rotating the oracle key

```bash
# 1. Generate
pnpm gen:oracle-key
# Save ORACLE_PRIVATE_KEY into your secret store, ORACLE_ADDRESS into .env

# 2. Rotate on the deployed AgentNFT (signer must equal AgentNFT.owner())
ORACLE_NEW_ADDRESS=0xNEW... pnpm rotate:oracle

# 3. Verify
pnpm check:deployment   # asserts AgentNFT.oracle == record.oracle
```

The `oracleHistory` field in `deployments/0g-testnet.json` keeps an
append-only log of all rotations.

## Security caveat

This service is the centralized trust point for SovereignClaw's iNFT
lifecycle. Anyone who controls `ORACLE_PRIVATE_KEY` can sign valid
transfer/revoke proofs that the contract will accept. Production deployments
must:

- Run inside a TEE (Intel TDX or equivalent) and ship attestations alongside.
- Rotate `ORACLE_PRIVATE_KEY` periodically.
- Persist the in-memory revocation registry (Phase 3 ships it process-local;
  this is documented in `src/store.ts`).
- Re-read on-chain `MemoryRevocation` at boot to rebuild the in-memory set.

See [docs/security.md](../../docs/security.md) for the full trust model.

## Tests

```bash
pnpm --filter @sovereignclaw/backend test                 # unit
INTEGRATION=1 pnpm --filter @sovereignclaw/backend test:integration   # against real testnet
```
