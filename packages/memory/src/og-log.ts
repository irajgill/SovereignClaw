/**
 * OG_Log - append-only MemoryProvider backed by 0G Storage Log.
 *
 * Every set() writes a JSON envelope {key, value, ts, seq} to the Log via the
 * @0gfoundation/0g-ts-sdk Indexer. Each write returns a 0G root hash, which is
 * the pointer surfaced to callers.
 *
 * Phase 1 index scope: 0G Storage Log does not expose "list all entries under
 * namespace X". This v0 adapter builds its index from writes made by this
 * provider instance only. Cross-process index recovery is deferred to Phase 5.
 */
import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk';
import type { Signer } from 'ethers';
import { ProviderClosedError, StorageError, StorageSdkError } from './errors.js';
import type { ListEntry, MemoryProvider, Pointer } from './provider.js';
import { isTombstone, TOMBSTONE } from './provider.js';

export interface OgLogOptions {
  /** Logical namespace, also used by encrypted() for AAD. */
  namespace: string;

  /** RPC URL for the 0G chain. */
  rpcUrl: string;

  /** 0G Storage indexer URL. */
  indexerUrl: string;

  /** ethers Signer with a funded wallet on the matching network. */
  signer: Signer;
}

interface LogEnvelope {
  key: string;
  value: string;
  ts: number;
  seq: number;
}

function encodeEnvelope(envelope: LogEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

function decodeEnvelope(bytes: Uint8Array): LogEnvelope {
  return JSON.parse(new TextDecoder().decode(bytes)) as LogEnvelope;
}

function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export function OG_Log(options: OgLogOptions): MemoryProvider {
  const { namespace, rpcUrl, indexerUrl, signer } = options;
  const indexer = new Indexer(indexerUrl);
  const index = new Map<string, { envelope: LogEnvelope; pointer: Pointer }>();
  let nextSeq = 0;
  let closed = false;

  function assertOpen(): void {
    if (closed) throw new ProviderClosedError(namespace);
  }

  async function setValue(key: string, value: Uint8Array): Promise<{ pointer: Pointer }> {
    assertOpen();
    const envelope: LogEnvelope = {
      key,
      value: bytesToBase64(value),
      ts: Date.now(),
      seq: nextSeq,
    };
    nextSeq += 1;

    const memData = new MemData(encodeEnvelope(envelope));
    const [tree, treeErr] = await memData.merkleTree();
    if (treeErr !== null) {
      throw new StorageSdkError(`OG_Log: merkleTree failed for key '${key}'`, treeErr);
    }

    const expectedRoot = tree?.rootHash();
    if (!expectedRoot) {
      throw new StorageError(`OG_Log: merkle tree returned no root for key '${key}'`);
    }

    // The SDK still ships ethers v5 types; runtime works with ethers v6.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [tx, uploadErr] = await indexer.upload(memData, rpcUrl, signer as any);
    if (uploadErr !== null) {
      throw new StorageSdkError(
        `OG_Log: upload failed for key '${key}' in namespace '${namespace}'`,
        uploadErr,
      );
    }

    if (!('rootHash' in tx)) {
      throw new StorageError(
        `OG_Log: unexpected fragmented upload response for envelope (key='${key}')`,
      );
    }

    const pointer = tx.rootHash;
    if (pointer !== expectedRoot) {
      throw new StorageError(
        `OG_Log: root mismatch for key '${key}': local=${expectedRoot} sdk=${pointer}`,
      );
    }

    index.set(key, { envelope, pointer });
    return { pointer };
  }

  return {
    namespace,

    async get(key: string): Promise<Uint8Array | null> {
      assertOpen();
      const entry = index.get(key);
      if (!entry) return null;
      const value = base64ToBytes(entry.envelope.value);
      if (isTombstone(value)) return null;
      return value;
    },

    set: setValue,

    list(prefix?: string): AsyncIterable<ListEntry> {
      assertOpen();
      const entries: ListEntry[] = [];
      for (const [key, { envelope, pointer }] of index.entries()) {
        if (isTombstone(base64ToBytes(envelope.value))) continue;
        if (prefix !== undefined && !key.startsWith(prefix)) continue;
        entries.push({ key, pointer });
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
      await setValue(key, new Uint8Array(TOMBSTONE));
    },

    async flush(): Promise<void> {
      assertOpen();
    },

    async close(): Promise<void> {
      closed = true;
      index.clear();
    },
  };
}

/**
 * Helper to read a single envelope from 0G Log given its root hash.
 *
 * Used by integration tests and by future cross-process index recovery.
 */
export async function readEnvelopeByRoot(
  indexerUrl: string,
  rootHash: string,
): Promise<LogEnvelope> {
  const indexer = new Indexer(indexerUrl);
  const { mkdtempSync, readFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const tmpDir = mkdtempSync(join(tmpdir(), 'sclaw-oglog-'));
  const outPath = join(tmpDir, 'envelope.bin');
  try {
    const err = await indexer.download(rootHash, outPath, true);
    if (err !== null) {
      throw new StorageSdkError(`OG_Log: download failed for root ${rootHash}`, err);
    }
    const bytes = new Uint8Array(readFileSync(outPath));
    return decodeEnvelope(bytes);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
