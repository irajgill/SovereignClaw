# @sovereignclaw/memory

Sovereign, encrypted, revocable memory primitives for SovereignClaw agents.
Storage backends are pluggable (`InMemory` for tests, `OG_Log` for 0G Storage)
and any backend can be wrapped with `encrypted(...)` to get authenticated
client-side encryption (AES-256-GCM, KEK derived from an EOA signer).

## Install

```bash
pnpm add @sovereignclaw/memory ethers
```

## 10-line quickstart

```typescript
import { JsonRpcProvider, Wallet } from 'ethers';
import { OG_Log, encrypted, deriveKekFromSigner } from '@sovereignclaw/memory';

const signer = new Wallet(process.env.PRIVATE_KEY!, new JsonRpcProvider(process.env.RPC_URL!));
const kek = await deriveKekFromSigner(signer, 'my-agent');
const memory = encrypted(
  OG_Log({
    namespace: 'my-agent',
    rpcUrl: process.env.RPC_URL!,
    indexerUrl: process.env.INDEXER_URL!,
    signer,
  }),
  { kek },
);
await memory.set('greeting', new TextEncoder().encode('hello from sovereignclaw'));
const value = await memory.get('greeting'); // plaintext Uint8Array; ciphertext on the log
```

## API

| Export                        | Kind      | Purpose                                                             |
| ----------------------------- | --------- | ------------------------------------------------------------------- |
| `MemoryProvider`              | interface | `get / set / delete / list / flush / close` over keyed byte values. |
| `InMemory(opts)`              | adapter   | Process-local backend. Namespaced. Used by tests and coordination.  |
| `OG_Log(opts)`                | adapter   | 0G Storage Log backend. Writes envelopes; keeps a pointer tree.     |
| `encrypted(provider, opts)`   | wrapper   | AES-256-GCM around any provider. KEK in, keys/ciphertext out.       |
| `deriveKekFromSigner`         | fn        | EIP-191 sign a namespaced message, keccak256 → 32-byte KEK.         |
| `encryptValue / decryptValue` | fn        | Lower-level GCM helpers with AAD binding.                           |
| `buildAad`                    | fn        | Builds the canonical AAD for a (namespace, key, version) tuple.     |
| `TOMBSTONE / isTombstone`     | const/fn  | Delete marker sentinel for append-only stores.                      |
| `readEnvelopeByRoot`          | fn        | Low-level: read a single envelope by its 0G root hash.              |

## Errors

All typed; all extend `MemoryError`:

| Error                      | When                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| `DecryptionError`          | Envelope failed to decrypt (wrong KEK, wrong AAD, corrupt data). |
| `TamperingDetectedError`   | GCM tag mismatch — the envelope was tampered with in transit.    |
| `MalformedCiphertextError` | Envelope header didn’t match the expected v1 layout.             |
| `StorageError`             | Backend rejected a read/write for a non-SDK reason.              |
| `StorageSdkError`          | 0G SDK threw or the indexer returned a transient fee/node error. |
| `InvalidKeyError`          | KEK is not 32 bytes / AAD is malformed.                          |
| `KeyDerivationError`       | `deriveKekFromSigner` failed (usually the signer refused).       |
| `ProviderClosedError`      | Operation after `provider.close()`.                              |

## What’s sovereign about this

- **Plaintext never leaves the wallet.** `encrypted()` encrypts before any
  network call. Anyone with only the indexer can read ciphertext.
- **The KEK is reproducible.** Derived from an EOA signature over a
  namespaced message, so the same wallet + namespace always gets the same
  KEK — no key storage service.
- **Append-only with tombstones.** `delete(key)` writes a tombstone, not
  a physical erase. Combined with `AgentNFT.revoke()` and the oracle’s
  revocation registry, this is how iNFT memory becomes unreadable.

## Further reading

- [`docs/architecture.md`](../../docs/architecture.md) — layered diagram + trust model.
- [`docs/benchmarks.md`](../../docs/benchmarks.md) — measured numbers and methodology.
- [`docs/dev-log.md`](../../docs/dev-log.md) — phase-by-phase design decisions.

## License

MIT — see the repo root.
