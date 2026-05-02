import { ethers } from 'ethers';
import { describe, expect, it } from 'vitest';
import {
  buildAad,
  decryptValue,
  deriveKekFromSigner,
  encryptValue,
  kekDerivationMessage,
} from '../src/crypto.js';
import {
  KeyDerivationError,
  MalformedCiphertextError,
  TamperingDetectedError,
} from '../src/errors.js';

// Fixed test wallet from common ethers test fixtures. Never use for anything real.
const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

function testWallet(): ethers.Wallet {
  return new ethers.Wallet(TEST_PK);
}

describe('crypto', () => {
  describe('kekDerivationMessage', () => {
    it('is deterministic for a namespace', () => {
      expect(kekDerivationMessage('foo')).toBe(kekDerivationMessage('foo'));
    });

    it('differs across namespaces', () => {
      expect(kekDerivationMessage('foo')).not.toBe(kekDerivationMessage('bar'));
    });

    it('includes a version marker so we can rotate', () => {
      expect(kekDerivationMessage('foo')).toContain('v1');
    });
  });

  describe('deriveKekFromSigner', () => {
    it('returns a usable AES-GCM key', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'test-ns');
      expect(kek.algorithm.name).toBe('AES-GCM');
      expect(kek.usages).toContain('encrypt');
      expect(kek.usages).toContain('decrypt');
      expect(kek.extractable).toBe(false);
    });

    it('is deterministic for the same wallet and namespace', async () => {
      const kek1 = await deriveKekFromSigner(testWallet(), 'ns');
      const kek2 = await deriveKekFromSigner(testWallet(), 'ns');
      const aad = buildAad('ns', 'k');
      const ct = await encryptValue(kek1, new TextEncoder().encode('hi'), aad);
      const pt = await decryptValue(kek2, ct, aad);
      expect(new TextDecoder().decode(pt)).toBe('hi');
    });

    it('produces different KEKs for different namespaces with the same wallet', async () => {
      const kekA = await deriveKekFromSigner(testWallet(), 'ns-a');
      const kekB = await deriveKekFromSigner(testWallet(), 'ns-b');
      const ct = await encryptValue(kekA, new TextEncoder().encode('x'), buildAad('ns-a', 'k'));

      await expect(decryptValue(kekB, ct, buildAad('ns-a', 'k'))).rejects.toBeInstanceOf(
        TamperingDetectedError,
      );
    });

    it('wraps signer rejection in KeyDerivationError', async () => {
      const badSigner = {
        signMessage: async (): Promise<string> => {
          throw new Error('user rejected');
        },
      } as unknown as ethers.Signer;

      await expect(deriveKekFromSigner(badSigner, 'ns')).rejects.toBeInstanceOf(KeyDerivationError);
    });
  });

  describe('encrypt/decrypt round-trip', () => {
    it('round-trips an empty payload', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'ns');
      const aad = buildAad('ns', 'empty');
      const ct = await encryptValue(kek, new Uint8Array(0), aad);
      const pt = await decryptValue(kek, ct, aad);
      expect(pt.length).toBe(0);
    });

    it('round-trips a small UTF-8 string', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'ns');
      const aad = buildAad('ns', 'k');
      const original = new TextEncoder().encode('hello, world');
      const ct = await encryptValue(kek, original, aad);
      const pt = await decryptValue(kek, ct, aad);
      expect(new TextDecoder().decode(pt)).toBe('hello, world');
    });

    it('round-trips a 64KB payload', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'ns');
      const aad = buildAad('ns', 'big');
      const original = new Uint8Array(64 * 1024);
      for (let i = 0; i < original.length; i += 1) original[i] = i & 0xff;
      const ct = await encryptValue(kek, original, aad);
      const pt = await decryptValue(kek, ct, aad);
      expect(pt).toEqual(original);
    });

    it('produces a different ciphertext on each call due to random IV', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'ns');
      const aad = buildAad('ns', 'k');
      const pt = new TextEncoder().encode('same plaintext');
      const ct1 = await encryptValue(kek, pt, aad);
      const ct2 = await encryptValue(kek, pt, aad);
      expect(ct1).not.toEqual(ct2);
    });
  });

  describe('tamper detection', () => {
    it('rejects decryption with wrong AAD', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'ns');
      const ct = await encryptValue(kek, new TextEncoder().encode('x'), buildAad('ns', 'k1'));

      await expect(decryptValue(kek, ct, buildAad('ns', 'k2'))).rejects.toBeInstanceOf(
        TamperingDetectedError,
      );
    });

    it('rejects decryption when ciphertext is mutated', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'ns');
      const aad = buildAad('ns', 'k');
      const ct = await encryptValue(kek, new TextEncoder().encode('x'), aad);
      ct[ct.length - 5]! ^= 0xff;

      await expect(decryptValue(kek, ct, aad)).rejects.toBeInstanceOf(TamperingDetectedError);
    });

    it('rejects decryption when IV is mutated', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'ns');
      const aad = buildAad('ns', 'k');
      const ct = await encryptValue(kek, new TextEncoder().encode('x'), aad);
      ct[0]! ^= 0xff;

      await expect(decryptValue(kek, ct, aad)).rejects.toBeInstanceOf(TamperingDetectedError);
    });

    it('rejects payloads too short to contain IV and tag', async () => {
      const kek = await deriveKekFromSigner(testWallet(), 'ns');

      await expect(
        decryptValue(kek, new Uint8Array(20), buildAad('ns', 'k')),
      ).rejects.toBeInstanceOf(MalformedCiphertextError);
    });
  });

  describe('buildAad', () => {
    it('binds namespace and key into a stable string', () => {
      const aad = buildAad('foo', 'bar');
      expect(new TextDecoder().decode(aad)).toBe('sovereignclaw:v1:foo:bar');
    });

    it('separates namespace and key components', () => {
      expect(buildAad('a', 'bc')).not.toEqual(buildAad('ab', 'c'));
    });
  });
});
