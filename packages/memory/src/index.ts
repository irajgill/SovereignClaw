/**
 * @sovereignclaw/memory - sovereign memory primitives.
 *
 * Public exports as of Step 1.2:
 *   - MemoryProvider, ListEntry, Pointer, TOMBSTONE, isTombstone
 *   - InMemory adapter
 *   - OG_Log adapter, readEnvelopeByRoot
 *   - encrypted() wrapper
 *   - deriveKekFromSigner, encryptValue, decryptValue, buildAad,
 *     kekDerivationMessage
 *   - All typed errors
 */
export const VERSION = '0.0.0';

export {
  type MemoryProvider,
  type ListEntry,
  type Pointer,
  TOMBSTONE,
  isTombstone,
} from './provider.js';

export { InMemory, type InMemoryOptions } from './in-memory.js';

export { OG_Log, readEnvelopeByRoot, type OgLogOptions } from './og-log.js';

export { encrypted, type EncryptedOptions } from './encrypted.js';

export {
  deriveKekFromSigner,
  encryptValue,
  decryptValue,
  buildAad,
  kekDerivationMessage,
} from './crypto.js';

export {
  MemoryError,
  DecryptionError,
  TamperingDetectedError,
  MalformedCiphertextError,
  StorageError,
  StorageSdkError,
  InvalidKeyError,
  KeyDerivationError,
  ProviderClosedError,
} from './errors.js';
