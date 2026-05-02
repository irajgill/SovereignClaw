import { describe, it, expect } from 'vitest';
import { createInMemoryStore } from '../../src/store.js';

describe('createInMemoryStore', () => {
  it('starts empty', () => {
    const s = createInMemoryStore();
    expect(s.size()).toBe(0);
    expect(s.has(1n)).toBe(false);
  });

  it('add then has', () => {
    const s = createInMemoryStore();
    s.add(7n, '0xabc');
    expect(s.has(7n)).toBe(true);
    expect(s.size()).toBe(1);
  });

  it('add is idempotent (no double-count)', () => {
    const s = createInMemoryStore();
    s.add(7n, '0xabc');
    s.add(7n, '0xabc');
    expect(s.size()).toBe(1);
  });
});
