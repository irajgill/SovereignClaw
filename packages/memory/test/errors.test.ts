import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  InvalidKeyError,
  KeyDerivationError,
  MalformedCiphertextError,
  MemoryError,
  ProviderClosedError,
  StorageError,
  StorageSdkError,
  TamperingDetectedError,
} from '../src/errors.js';

describe('errors', () => {
  it('all errors extend MemoryError', () => {
    const cases: Array<new (message: string) => Error> = [
      DecryptionError,
      InvalidKeyError,
      KeyDerivationError,
      MalformedCiphertextError,
      StorageError,
      TamperingDetectedError,
    ];

    for (const Ctor of cases) {
      const err = new Ctor('test');
      expect(err).toBeInstanceOf(MemoryError);
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe(Ctor.name);
    }
  });

  it('TamperingDetectedError is a DecryptionError', () => {
    expect(new TamperingDetectedError('x')).toBeInstanceOf(DecryptionError);
  });

  it('StorageSdkError preserves the underlying SDK error', () => {
    const sdkErr = { code: 'ENETUNREACH', message: 'unreachable' };
    const err = new StorageSdkError('upload failed', sdkErr);
    expect(err.sdkError).toBe(sdkErr);
    expect(err.message).toBe('upload failed');
  });

  it('ProviderClosedError includes the namespace in the message', () => {
    const err = new ProviderClosedError('research-state');
    expect(err.message).toContain('research-state');
  });

  it('errors preserve cause when provided', () => {
    const cause = new Error('root cause');
    const err = new MemoryError('wrapper', { cause });
    expect(err.cause).toBe(cause);
  });
});
