/**
 * encrypted() - a MemoryProvider wrapper that transparently encrypts values.
 *
 * Wraps any inner provider (InMemory, OG_Log, OG_KV, etc.) so that:
 *   - set(key, value) stores AES-256-GCM(value, KEK) into the inner provider
 *   - get(key) decrypts the inner value before returning
 *   - AAD binds each ciphertext to (namespace, key) via buildAad()
 *
 * The KEK is provided by the caller, typically derived via deriveKekFromSigner.
 * Tombstones are not encrypted because they contain no secret and providers need
 * to filter deleted keys without decrypting every value.
 */
import type { webcrypto } from 'node:crypto';
import { buildAad, decryptValue, encryptValue } from './crypto.js';
import type { ListEntry, MemoryProvider, Pointer } from './provider.js';
import { isTombstone, TOMBSTONE } from './provider.js';

export interface EncryptedOptions {
  /**
   * The Key Encryption Key. Caller is responsible for derivation and lifecycle.
   */
  kek: webcrypto.CryptoKey;
}

export function encrypted(inner: MemoryProvider, options: EncryptedOptions): MemoryProvider {
  const { kek } = options;
  const namespace = inner.namespace;

  return {
    namespace,

    async get(key: string): Promise<Uint8Array | null> {
      const ct = await inner.get(key);
      if (ct === null) return null;
      if (isTombstone(ct)) return null;
      return decryptValue(kek, ct, buildAad(namespace, key));
    },

    async set(key: string, value: Uint8Array): Promise<{ pointer: Pointer }> {
      const ct = await encryptValue(kek, value, buildAad(namespace, key));
      return inner.set(key, ct);
    },

    list(prefix?: string): AsyncIterable<ListEntry> {
      return inner.list(prefix);
    },

    async delete(key: string): Promise<void> {
      await inner.set(key, new Uint8Array(TOMBSTONE));
    },

    async flush(): Promise<void> {
      return inner.flush();
    },

    async close(): Promise<void> {
      return inner.close();
    },
  };
}
