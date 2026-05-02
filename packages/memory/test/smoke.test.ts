import { describe, expect, it } from 'vitest';
import * as memory from '../src/index.js';

describe('@sovereignclaw/memory barrel', () => {
  it('exposes VERSION', () => {
    expect(memory.VERSION).toBe('0.0.0');
  });

  it('exposes core types and constructors', () => {
    expect(typeof memory.InMemory).toBe('function');
    expect(typeof memory.deriveKekFromSigner).toBe('function');
    expect(typeof memory.encryptValue).toBe('function');
    expect(typeof memory.decryptValue).toBe('function');
    expect(typeof memory.buildAad).toBe('function');
    expect(memory.TOMBSTONE).toBeInstanceOf(Uint8Array);
    expect(typeof memory.isTombstone).toBe('function');
  });

  it('exposes all typed errors', () => {
    expect(memory.MemoryError.prototype).toBeInstanceOf(Error);
    expect(memory.DecryptionError.prototype).toBeInstanceOf(memory.MemoryError);
    expect(memory.TamperingDetectedError.prototype).toBeInstanceOf(memory.DecryptionError);
    expect(memory.StorageError.prototype).toBeInstanceOf(memory.MemoryError);
  });
});
