/**
 * Bus — append-only event log over a MemoryProvider.
 *
 * Writes each event as a JSON envelope under a zero-padded seq key
 * (`evt:0000000000000000` → event #0, etc.). Readers use `MemoryProvider.list`
 * with the `evt:` prefix and sort by key to get chronological order.
 *
 * Single-writer guarantees strict monotonic seq. The §8.1 multi-writer
 * tiebreak on `(seq, writerAddr)` is Phase 5.1 — when we add that, the
 * envelope gains a `writerAddr` field and the seq generator becomes
 * (local_clock, counter). Keeping the API stable now is deliberate.
 */
import type { MemoryProvider, Pointer } from '@sovereignclaw/memory';
import { BusAppendError, BusReplayError } from './errors.js';
import { eventKey, SeqCounter, seqFromKey } from './seq.js';
import type { BusAppendResult, BusEvent } from './types.js';

export interface BusOptions {
  meshId: string;
  provider: MemoryProvider;
  initialSeq?: number;
}

export type BusEventHandler = (event: BusEvent) => void | Promise<void>;

/** Append-only event log. Thin on purpose — patterns add the semantics. */
export class Bus {
  readonly meshId: string;
  private readonly provider: MemoryProvider;
  private readonly counter: SeqCounter;
  private readonly listeners = new Set<BusEventHandler>();

  constructor(options: BusOptions) {
    this.meshId = options.meshId;
    this.provider = options.provider;
    this.counter = new SeqCounter(options.initialSeq ?? 0);
  }

  /** Current namespace — derived from the underlying MemoryProvider. */
  get namespace(): string {
    return this.provider.namespace;
  }

  /** Attach a listener for every appended event. Fires after durable write. */
  on(handler: BusEventHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  /** Number of seqs issued so far (next append gets this value). */
  nextSeq(): number {
    return this.counter.peek();
  }

  /**
   * Append an event to the bus. The caller supplies `type`, `fromAgent`,
   * `payload`, and optionally `toAgent` / `parentSeq`; the bus fills the
   * rest.
   */
  async append<P>(
    input: Omit<BusEvent<P>, 'meshId' | 'seq' | 'timestamp'>,
  ): Promise<BusAppendResult<P>> {
    const seq = this.counter.next();
    const event: BusEvent<P> = {
      meshId: this.meshId,
      seq,
      timestamp: Date.now(),
      ...input,
    };
    const key = eventKey(seq);
    const bytes = new TextEncoder().encode(JSON.stringify(event));
    let pointer: Pointer;
    try {
      const result = await this.provider.set(key, bytes);
      pointer = result.pointer;
    } catch (err) {
      throw new BusAppendError(
        `Bus.append: provider.set failed for ${key} on mesh '${this.meshId}'`,
        {
          cause: err as Error,
        },
      );
    }

    // Fire listeners after durable write; a listener throwing should not
    // block subsequent listeners or rollback the append.
    for (const handler of this.listeners) {
      try {
        const r = handler(event);
        if (r instanceof Promise) await r.catch(() => undefined);
      } catch {
        // swallow — listener errors are their problem
      }
    }

    return { event, pointer, key };
  }

  /**
   * Read every event that this bus has seen so far, in seq order. Backed by
   * `MemoryProvider.list('evt:')`. For 0G Log the index is process-local
   * today (§Phase 1 carryover #2); cross-process replay is Phase 5.1.
   */
  async replay(fromSeq = 0): Promise<BusEvent[]> {
    const entries: Array<{ key: string; seq: number }> = [];
    try {
      for await (const entry of this.provider.list('evt:')) {
        const seq = seqFromKey(entry.key);
        if (seq === null) continue;
        if (seq < fromSeq) continue;
        entries.push({ key: entry.key, seq });
      }
    } catch (err) {
      throw new BusReplayError(
        `Bus.replay: provider.list failed on mesh '${this.meshId}'`,
        { cause: err as Error },
      );
    }
    entries.sort((a, b) => a.seq - b.seq);

    const events: BusEvent[] = [];
    for (const { key } of entries) {
      const bytes = await this.provider.get(key);
      if (!bytes) continue;
      try {
        events.push(JSON.parse(new TextDecoder().decode(bytes)) as BusEvent);
      } catch (err) {
        throw new BusReplayError(
          `Bus.replay: failed to parse event at key ${key}`,
          { cause: err as Error },
        );
      }
    }
    return events;
  }

  /** Flush the underlying provider. Not required, but semantic-preserving. */
  async flush(): Promise<void> {
    await this.provider.flush();
  }

  /** Close the underlying provider and drop listeners. */
  async close(): Promise<void> {
    this.listeners.clear();
    await this.provider.close();
  }
}
