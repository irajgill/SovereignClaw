/**
 * Monotonic sequence generator for bus events.
 *
 * §8.1 spec: seq is derived from (local_clock + atomic_counter). Single-
 * process Mesh v0 uses a plain counter since there's only one writer; the
 * (seq, writerAddr) tiebreak rule is Phase 5.1 territory when we introduce
 * multi-writer mesh orchestration across processes.
 *
 * Keys are zero-padded so `OG_Log.list(prefix='evt:')` iterates in
 * lexicographic order, which matches numerical order for sorted replay.
 */

/** Width of the zero-padded sequence in bus event keys. */
export const SEQ_KEY_WIDTH = 16;

/** Bus event key prefix. */
export const EVENT_KEY_PREFIX = 'evt:';

/** Build the canonical bus event key for a seq. */
export function eventKey(seq: number): string {
  if (!Number.isInteger(seq) || seq < 0) {
    throw new TypeError(`eventKey: seq must be a non-negative integer, got ${seq}`);
  }
  return `${EVENT_KEY_PREFIX}${seq.toString().padStart(SEQ_KEY_WIDTH, '0')}`;
}

/** Parse a seq back out of a canonical event key. */
export function seqFromKey(key: string): number | null {
  if (!key.startsWith(EVENT_KEY_PREFIX)) return null;
  const s = key.slice(EVENT_KEY_PREFIX.length);
  if (s.length !== SEQ_KEY_WIDTH) return null;
  const n = Number(s);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

/** Stateful seq generator. Bus holds one of these per instance. */
export class SeqCounter {
  private current = 0;

  constructor(initial = 0) {
    if (!Number.isInteger(initial) || initial < 0) {
      throw new TypeError(`SeqCounter: initial must be a non-negative integer, got ${initial}`);
    }
    this.current = initial;
  }

  /** Returns the next seq and advances. */
  next(): number {
    const seq = this.current;
    this.current += 1;
    return seq;
  }

  /** Peek without advancing. */
  peek(): number {
    return this.current;
  }

  /** Reset to a specific value, e.g. after replay from a checkpoint. */
  resetTo(value: number): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new TypeError(`SeqCounter.resetTo: value must be a non-negative integer, got ${value}`);
    }
    this.current = value;
  }
}
