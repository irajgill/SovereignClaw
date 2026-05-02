/**
 * Cryptographic primitives for @sovereignclaw/memory.
 *
 * Implements AES-256-GCM authenticated encryption and HKDF-SHA-256 KEK
 * derivation from deterministic wallet signatures. We own this layer because
 * the sovereign part is key derivation from wallet authority.
 */
import { hkdf as nodeHkdf, webcrypto } from 'node:crypto';
import { promisify } from 'node:util';
import type { Signer } from 'ethers';
import { KeyDerivationError, MalformedCiphertextError, TamperingDetectedError } from './errors.js';

const subtle = webcrypto.subtle;
const hkdf = promisify(nodeHkdf);
type AesGcmKey = webcrypto.CryptoKey;

const IV_BYTES = 12;
const KEK_BYTES = 32;
const KEK_INFO = new TextEncoder().encode('sovereignclaw:memory:kek:v1');
const KEK_SALT = new TextEncoder().encode('sovereignclaw:memory:salt:v1');

/**
 * The fixed message a wallet signs to derive its KEK seed.
 *
 * The version suffix lets us rotate KEKs in the future by bumping it.
 */
export function kekDerivationMessage(namespace: string): string {
  return `SovereignClaw KEK derivation v1\nNamespace: ${namespace}`;
}

/**
 * Derive a non-extractable 256-bit AES-GCM KEK from a wallet signature.
 */
export async function deriveKekFromSigner(signer: Signer, namespace: string): Promise<AesGcmKey> {
  let signature: string;
  try {
    signature = await signer.signMessage(kekDerivationMessage(namespace));
  } catch (err) {
    throw new KeyDerivationError(
      `wallet refused to sign KEK derivation message for namespace '${namespace}'`,
      { cause: err },
    );
  }

  const hex = signature.startsWith('0x') ? signature.slice(2) : signature;
  const sigBytes = hexToBytes(hex);
  const seedBuf = await subtle.digest('SHA-256', sigBytes);
  const seed = new Uint8Array(seedBuf);
  const kekBytes = await hkdf('sha256', seed, KEK_SALT, KEK_INFO, KEK_BYTES);

  return subtle.importKey('raw', kekBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/**
 * Encrypt a payload with AES-256-GCM under the given key.
 *
 * Output layout: IV (12 bytes) || ciphertext_with_tag.
 */
export async function encryptValue(
  kek: AesGcmKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const iv = webcrypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ctBuf = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, kek, plaintext);
  const ct = new Uint8Array(ctBuf);
  const out = new Uint8Array(IV_BYTES + ct.length);
  out.set(iv, 0);
  out.set(ct, IV_BYTES);
  return out;
}

/**
 * Decrypt an AES-256-GCM payload. Verifies AAD and throws typed errors.
 */
export async function decryptValue(
  kek: AesGcmKey,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  if (ciphertext.length < IV_BYTES + 16) {
    throw new MalformedCiphertextError(
      `ciphertext too short: got ${ciphertext.length} bytes, need at least ${IV_BYTES + 16}`,
    );
  }

  const iv = ciphertext.slice(0, IV_BYTES);
  const ct = ciphertext.slice(IV_BYTES);

  try {
    const ptBuf = await subtle.decrypt({ name: 'AES-GCM', iv, additionalData: aad }, kek, ct);
    return new Uint8Array(ptBuf);
  } catch (err) {
    throw new TamperingDetectedError(
      'AES-GCM authentication failed: wrong key, wrong AAD, or tampered ciphertext',
      { cause: err },
    );
  }
}

/**
 * Build AAD that binds a ciphertext to its (namespace, key) pair.
 */
export function buildAad(namespace: string, key: string): Uint8Array {
  return new TextEncoder().encode(`sovereignclaw:v1:${namespace}:${key}`);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}
