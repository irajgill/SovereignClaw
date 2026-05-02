import { describe, expect, it } from 'vitest';
import { ProviderClosedError } from '../src/errors.js';
import { InMemory } from '../src/in-memory.js';

const enc = (value: string): Uint8Array => new TextEncoder().encode(value);
const dec = (value: Uint8Array): string => new TextDecoder().decode(value);

describe('InMemory provider', () => {
  it('exposes its namespace', () => {
    const provider = InMemory({ namespace: 'ns' });
    expect(provider.namespace).toBe('ns');
  });

  it('returns null for unset keys', async () => {
    const provider = InMemory({ namespace: 'ns' });
    expect(await provider.get('missing')).toBeNull();
  });

  it('round-trips a value', async () => {
    const provider = InMemory({ namespace: 'ns' });
    const { pointer } = await provider.set('k', enc('hello'));
    expect(pointer).toMatch(/^0x[0-9a-f]{64}$/);
    const got = await provider.get('k');
    expect(got).not.toBeNull();
    expect(dec(got!)).toBe('hello');
  });

  it('latest write wins', async () => {
    const provider = InMemory({ namespace: 'ns' });
    await provider.set('k', enc('first'));
    await provider.set('k', enc('second'));
    const got = await provider.get('k');
    expect(dec(got!)).toBe('second');
  });

  it('returns a defensive copy from get()', async () => {
    const provider = InMemory({ namespace: 'ns' });
    await provider.set('k', enc('original'));
    const first = await provider.get('k');
    const second = await provider.get('k');
    expect(first).not.toBe(second);
    first![0] = 0xff;
    const third = await provider.get('k');
    expect(third![0]).toBe(enc('original')[0]);
  });

  it('soft-deletes via tombstone', async () => {
    const provider = InMemory({ namespace: 'ns' });
    await provider.set('k', enc('alive'));
    expect(await provider.get('k')).not.toBeNull();
    await provider.delete('k');
    expect(await provider.get('k')).toBeNull();
  });

  it('lists all keys', async () => {
    const provider = InMemory({ namespace: 'ns' });
    await provider.set('a', enc('1'));
    await provider.set('b', enc('2'));
    await provider.set('c', enc('3'));
    const seen = new Set<string>();
    for await (const entry of provider.list()) seen.add(entry.key);
    expect(seen).toEqual(new Set(['a', 'b', 'c']));
  });

  it('lists with prefix filter', async () => {
    const provider = InMemory({ namespace: 'ns' });
    await provider.set('user:a', enc('1'));
    await provider.set('user:b', enc('2'));
    await provider.set('other:c', enc('3'));
    const seen = new Set<string>();
    for await (const entry of provider.list('user:')) seen.add(entry.key);
    expect(seen).toEqual(new Set(['user:a', 'user:b']));
  });

  it('omits deleted keys from list()', async () => {
    const provider = InMemory({ namespace: 'ns' });
    await provider.set('a', enc('1'));
    await provider.set('b', enc('2'));
    await provider.delete('a');
    const seen: string[] = [];
    for await (const entry of provider.list()) seen.push(entry.key);
    expect(seen).toEqual(['b']);
  });

  it('flush is a no-op that resolves', async () => {
    const provider = InMemory({ namespace: 'ns' });
    await provider.set('k', enc('v'));
    await expect(provider.flush()).resolves.toBeUndefined();
  });

  it('throws ProviderClosedError after close()', async () => {
    const provider = InMemory({ namespace: 'ns' });
    await provider.set('k', enc('v'));
    await provider.close();

    await expect(provider.get('k')).rejects.toBeInstanceOf(ProviderClosedError);
    await expect(provider.set('k2', enc('x'))).rejects.toBeInstanceOf(ProviderClosedError);
  });

  it('returns synthetic pointers that look like 0G root hashes', async () => {
    const provider = InMemory({ namespace: 'ns' });
    const result = await provider.set('k', enc('v'));
    expect(result.pointer).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('different writes get different pointers', async () => {
    const provider = InMemory({ namespace: 'ns' });
    const first = await provider.set('a', enc('1'));
    const second = await provider.set('b', enc('2'));
    expect(first.pointer).not.toBe(second.pointer);
  });
});
