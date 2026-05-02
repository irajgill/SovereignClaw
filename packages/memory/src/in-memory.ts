/**
 * In-memory MemoryProvider: a Map-backed adapter for unit tests and local dev.
 *
 * Not durable. Not encrypted. Not for production.
 */
import { webcrypto } from 'node:crypto';
import { ProviderClosedError } from './errors.js';
import type { ListEntry, MemoryProvider, Pointer } from './provider.js';
import { isTombstone, TOMBSTONE } from './provider.js';

export interface InMemoryOptions {
  namespace: string;
}

export function InMemory(options: InMemoryOptions): MemoryProvider {
  const namespace = options.namespace;
  const store = new Map<string, { value: Uint8Array; pointer: Pointer }>();
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new ProviderClosedError(namespace);
  }

  function syntheticPointer(): Pointer {
    const bytes = webcrypto.getRandomValues(new Uint8Array(32));
    return `0x${Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')}`;
  }

  return {
    namespace,

    async get(key: string): Promise<Uint8Array | null> {
      assertOpen();
      const entry = store.get(key);
      if (!entry) return null;
      if (isTombstone(entry.value)) return null;
      return new Uint8Array(entry.value);
    },

    async set(key: string, value: Uint8Array): Promise<{ pointer: Pointer }> {
      assertOpen();
      const pointer = syntheticPointer();
      store.set(key, { value: new Uint8Array(value), pointer });
      return { pointer };
    },

    list(prefix?: string): AsyncIterable<ListEntry> {
      assertOpen();
      const entries: ListEntry[] = [];
      for (const [key, entry] of store.entries()) {
        if (isTombstone(entry.value)) continue;
        if (prefix !== undefined && !key.startsWith(prefix)) continue;
        entries.push({ key, pointer: entry.pointer });
      }

      return {
        [Symbol.asyncIterator](): AsyncIterator<ListEntry> {
          let index = 0;
          return {
            async next(): Promise<IteratorResult<ListEntry>> {
              const entry = entries[index];
              index += 1;
              if (!entry) return { done: true, value: undefined };
              return { done: false, value: entry };
            },
          };
        },
      };
    },

    async delete(key: string): Promise<void> {
      assertOpen();
      const pointer = syntheticPointer();
      store.set(key, { value: new Uint8Array(TOMBSTONE), pointer });
    },

    async flush(): Promise<void> {
      assertOpen();
    },

    async close(): Promise<void> {
      closed = true;
      store.clear();
    },
  };
}
