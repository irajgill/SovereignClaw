/**
 * Typed error classes for @sovereignclaw/memory.
 *
 * Per working agreement Section 19.8: no bare `throw new Error('...')` in
 * shipped code. Callers can `instanceof` these to handle specific failure modes.
 */

/** Base class. All memory errors extend this so callers can catch broadly. */
export class MemoryError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Thrown when a key's value cannot be decrypted. */
export class DecryptionError extends MemoryError {}

/** Thrown when ciphertext fails AES-GCM authentication. */
export class TamperingDetectedError extends DecryptionError {}

/** Thrown when an encrypted value is too short to contain its IV + tag header. */
export class MalformedCiphertextError extends DecryptionError {}

/** Thrown when a 0G Storage operation fails. */
export class StorageError extends MemoryError {}

/** Thrown when the wrapped 0G SDK returns an error from upload/download. */
export class StorageSdkError extends StorageError {
  constructor(
    message: string,
    public readonly sdkError: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Thrown when a key is invalid. */
export class InvalidKeyError extends MemoryError {}

/** Thrown when a key derivation step fails, e.g. wallet refused to sign. */
export class KeyDerivationError extends MemoryError {}

/** Thrown when a method is called on a closed provider. */
export class ProviderClosedError extends MemoryError {
  constructor(namespace: string) {
    super(`MemoryProvider for namespace '${namespace}' has been closed`);
  }
}
