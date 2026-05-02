import { ethers } from 'ethers';
import { describe, expect, it } from 'vitest';
import { deriveKekFromSigner } from '../src/crypto.js';
import { encrypted } from '../src/encrypted.js';
import { TamperingDetectedError } from '../src/errors.js';
import { InMemory } from '../src/in-memory.js';

const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const wallet = (): ethers.Wallet => new ethers.Wallet(TEST_PK);

const enc = (value: string): Uint8Array => new TextEncoder().encode(value);
const dec = (value: Uint8Array): string => new TextDecoder().decode(value);

describe('encrypted() wrapper', () => {
  it('preserves the inner namespace', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const inner = InMemory({ namespace: 'ns' });
    const provider = encrypted(inner, { kek });
    expect(provider.namespace).toBe('ns');
  });

  it('round-trips a value through encryption', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const inner = InMemory({ namespace: 'ns' });
    const provider = encrypted(inner, { kek });

    await provider.set('greeting', enc('hello'));
    const got = await provider.get('greeting');
    expect(got).not.toBeNull();
    expect(dec(got!)).toBe('hello');
  });

  it('returns null for unset keys', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const provider = encrypted(InMemory({ namespace: 'ns' }), { kek });
    expect(await provider.get('missing')).toBeNull();
  });

  it('stores ciphertext rather than plaintext in the inner provider', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const inner = InMemory({ namespace: 'ns' });
    const provider = encrypted(inner, { kek });

    const plaintext = enc('secret-value-12345');
    await provider.set('k', plaintext);

    const stored = await inner.get('k');
    expect(stored).not.toBeNull();
    expect(stored).not.toEqual(plaintext);
    expect(stored!.length).toBe(plaintext.length + 28);
  });

  it('detects tampering with stored ciphertext', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const inner = InMemory({ namespace: 'ns' });
    const provider = encrypted(inner, { kek });

    await provider.set('k', enc('original'));
    const ct = await inner.get('k');
    ct![ct!.length - 3]! ^= 0xff;
    await inner.set('k', ct!);

    await expect(provider.get('k')).rejects.toBeInstanceOf(TamperingDetectedError);
  });

  it('rejects ciphertext encrypted under a different namespace', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns-original');
    const innerA = InMemory({ namespace: 'ns-original' });
    const providerA = encrypted(innerA, { kek });
    await providerA.set('k', enc('hello'));
    const ct = await innerA.get('k');

    const innerB = InMemory({ namespace: 'ns-different' });
    await innerB.set('k', ct!);
    const providerB = encrypted(innerB, { kek });

    await expect(providerB.get('k')).rejects.toBeInstanceOf(TamperingDetectedError);
  });

  it('rejects ciphertext under a different key', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const inner = InMemory({ namespace: 'ns' });
    const provider = encrypted(inner, { kek });

    await provider.set('original-key', enc('hello'));
    const ct = await inner.get('original-key');

    await inner.set('different-key', ct!);
    await expect(provider.get('different-key')).rejects.toBeInstanceOf(TamperingDetectedError);
  });

  it('delete() makes get() return null', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const inner = InMemory({ namespace: 'ns' });
    const provider = encrypted(inner, { kek });

    await provider.set('k', enc('alive'));
    expect(await provider.get('k')).not.toBeNull();
    await provider.delete('k');

    // After delete, the key reads as null through both the wrapper and
    // the inner provider (InMemory filters tombstones in its own get()).
    expect(await provider.get('k')).toBeNull();
    expect(await inner.get('k')).toBeNull();
  });

  it('list() reflects the inner provider and filters tombstones', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const inner = InMemory({ namespace: 'ns' });
    const provider = encrypted(inner, { kek });

    await provider.set('a', enc('1'));
    await provider.set('b', enc('2'));
    await provider.delete('a');

    const seen: string[] = [];
    for await (const entry of provider.list()) seen.push(entry.key);
    expect(seen).toEqual(['b']);
  });

  it('flush and close delegate to the inner provider', async () => {
    const kek = await deriveKekFromSigner(wallet(), 'ns');
    const inner = InMemory({ namespace: 'ns' });
    const provider = encrypted(inner, { kek });

    await expect(provider.flush()).resolves.toBeUndefined();
    await expect(provider.close()).resolves.toBeUndefined();
  });
});
