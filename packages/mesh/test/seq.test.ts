import { describe, expect, it } from 'vitest';
import { EVENT_KEY_PREFIX, SEQ_KEY_WIDTH, SeqCounter, eventKey, seqFromKey } from '../src/seq.js';

describe('seq', () => {
  it('eventKey pads to fixed width', () => {
    const key = eventKey(7);
    expect(key.startsWith(EVENT_KEY_PREFIX)).toBe(true);
    expect(key.length).toBe(EVENT_KEY_PREFIX.length + SEQ_KEY_WIDTH);
    expect(key).toBe('evt:0000000000000007');
  });

  it('eventKey rejects negative or non-integer', () => {
    expect(() => eventKey(-1)).toThrow(TypeError);
    expect(() => eventKey(1.5)).toThrow(TypeError);
  });

  it('seqFromKey round-trips', () => {
    for (const seq of [0, 1, 42, 1_000_000]) {
      expect(seqFromKey(eventKey(seq))).toBe(seq);
    }
  });

  it('seqFromKey returns null on non-event keys', () => {
    expect(seqFromKey('manifest')).toBeNull();
    expect(seqFromKey('evt:short')).toBeNull();
    expect(seqFromKey('evt:zzzzzzzzzzzzzzzz')).toBeNull();
  });

  it('SeqCounter issues strictly monotonic values', () => {
    const c = new SeqCounter();
    expect(c.peek()).toBe(0);
    expect(c.next()).toBe(0);
    expect(c.next()).toBe(1);
    expect(c.next()).toBe(2);
    expect(c.peek()).toBe(3);
  });

  it('SeqCounter accepts an initial value', () => {
    const c = new SeqCounter(50);
    expect(c.next()).toBe(50);
    expect(c.next()).toBe(51);
  });

  it('SeqCounter rejects invalid initial values', () => {
    expect(() => new SeqCounter(-1)).toThrow(TypeError);
    expect(() => new SeqCounter(1.5)).toThrow(TypeError);
  });

  it('lexicographic key order equals seq order', () => {
    const keys = [3, 1, 2, 100, 0].map(eventKey).sort();
    const seqs = keys.map(seqFromKey);
    expect(seqs).toEqual([0, 1, 2, 3, 100]);
  });

  it('keys with different seqs are unique', () => {
    const keys = new Set([0, 1, 2, 3].map(eventKey));
    expect(keys.size).toBe(4);
  });
});
