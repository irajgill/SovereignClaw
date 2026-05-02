/**
 * Integration tests for OG_Log against 0G Galileo testnet.
 *
 * These tests run only when INTEGRATION=1 is set and require RPC_URL,
 * INDEXER_URL, and PRIVATE_KEY environment variables.
 */
import { ethers } from 'ethers';
import { beforeAll, describe, expect, it } from 'vitest';
import { deriveKekFromSigner } from '../../src/crypto.js';
import { encrypted } from '../../src/encrypted.js';
import { OG_Log, readEnvelopeByRoot } from '../../src/og-log.js';

const SHOULD_RUN = process.env.INTEGRATION === '1';
const describeMaybe = SHOULD_RUN ? describe : describe.skip;

describeMaybe('OG_Log (integration, real testnet)', () => {
  const RPC_URL = process.env.RPC_URL;
  const INDEXER_URL = process.env.INDEXER_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;

  beforeAll(() => {
    if (!RPC_URL || !INDEXER_URL || !PRIVATE_KEY) {
      throw new Error('Integration tests require RPC_URL, INDEXER_URL, PRIVATE_KEY env vars');
    }
  });

  function makeProvider(namespace: string): {
    provider: ReturnType<typeof OG_Log>;
    signer: ethers.Wallet;
  } {
    const provider = new ethers.JsonRpcProvider(RPC_URL!);
    const signer = new ethers.Wallet(PRIVATE_KEY!, provider);
    return {
      provider: OG_Log({
        namespace,
        rpcUrl: RPC_URL!,
        indexerUrl: INDEXER_URL!,
        signer,
      }),
      signer,
    };
  }

  it('round-trips a small value through real 0G Storage', async () => {
    const { provider } = makeProvider(`og-log-itest-${Date.now()}`);
    const value = new TextEncoder().encode(`sovereignclaw integration ts=${Date.now()}`);

    const { pointer } = await provider.set('k1', value);
    expect(pointer).toMatch(/^0x[0-9a-f]{64}$/);

    const got = await provider.get('k1');
    expect(got).toEqual(value);

    await provider.close();
  }, 60_000);

  it('end-to-end: encrypted(OG_Log) with wallet-derived KEK', async () => {
    const namespace = `og-log-encrypted-itest-${Date.now()}`;
    const { provider: inner, signer } = makeProvider(namespace);
    const kek = await deriveKekFromSigner(signer, namespace);
    const provider = encrypted(inner, { kek });

    const plaintext = new TextEncoder().encode('a sovereign secret');
    const { pointer } = await provider.set('secret-key', plaintext);
    expect(pointer).toMatch(/^0x[0-9a-f]{64}$/);

    const got = await provider.get('secret-key');
    expect(got).toEqual(plaintext);

    const envelope = await readEnvelopeByRoot(INDEXER_URL!, pointer);
    expect(envelope.key).toBe('secret-key');
    const storedBytes = Buffer.from(envelope.value, 'base64');
    expect(storedBytes).not.toEqual(Buffer.from(plaintext));
    expect(storedBytes.length).toBe(plaintext.length + 28);

    await provider.close();
  }, 90_000);

  it('readEnvelopeByRoot fetches a written envelope', async () => {
    const namespace = `og-log-byroot-itest-${Date.now()}`;
    const { provider } = makeProvider(namespace);
    const value = new TextEncoder().encode('roundtrip-by-root');

    const { pointer } = await provider.set('lookup-key', value);

    const envelope = await readEnvelopeByRoot(INDEXER_URL!, pointer);
    expect(envelope.key).toBe('lookup-key');
    expect(envelope.seq).toBe(0);
    expect(typeof envelope.ts).toBe('number');
    const recovered = Buffer.from(envelope.value, 'base64');
    expect(new Uint8Array(recovered)).toEqual(value);

    await provider.close();
  }, 60_000);
});
