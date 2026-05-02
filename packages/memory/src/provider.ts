/**
 * The MemoryProvider interface, the heart of @sovereignclaw/memory.
 *
 * Every adapter implements this small contract so callers can compose providers,
 * for example `encrypted(OG_Log(...))`, rather than configuring one monolith.
 */

/** A pointer back to the canonical record of a write. For 0G adapters, this is the root hash. */
export type Pointer = string;

/** Metadata returned alongside a list() entry. */
export interface ListEntry {
  key: string;
  pointer: Pointer;
}

/**
 * The core memory contract. All operations are async.
 *
 * Implementations must return null from get() if no value has been set, support
 * concurrent calls safely with latest-write-wins semantics, and throw typed
 * MemoryError subclasses on failure.
 */
export interface MemoryProvider {
  /** Logical namespace this provider operates under. Used for encrypted AAD. */
  readonly namespace: string;

  /** Fetch the latest value for a key, or null if never set. */
  get(key: string): Promise<Uint8Array | null>;

  /** Write a value for a key. Returns the pointer, root hash for 0G adapters. */
  set(key: string, value: Uint8Array): Promise<{ pointer: Pointer }>;

  /** Iterate all known keys, optionally filtered by prefix. Order is implementation-defined. */
  list(prefix?: string): AsyncIterable<ListEntry>;

  /** Soft-delete by writing a tombstone marker. After delete, get() returns null. */
  delete(key: string): Promise<void>;

  /** Force any pending cached writes to durable storage. */
  flush(): Promise<void>;

  /** Release held resources. Subsequent operations should throw ProviderClosedError. */
  close(): Promise<void>;
}

/** Marker value used as the tombstone for soft-deleted keys. */
export const TOMBSTONE = new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0xde, 0xad, 0xbe, 0xef]);

/** Detects whether a returned value is the tombstone marker. */
export function isTombstone(value: Uint8Array): boolean {
  if (value.length !== TOMBSTONE.length) return false;
  for (let i = 0; i < TOMBSTONE.length; i += 1) {
    if (value[i] !== TOMBSTONE[i]) return false;
  }
  return true;
}
