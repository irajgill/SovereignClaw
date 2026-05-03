import { describe, expect, it } from 'vitest';
import { Wallet, AbiCoder, recoverAddress, getBytes, keccak256 } from 'ethers';
import { Hono } from 'hono';
import { loadOracleKey } from '../../src/crypto.js';
import { createInMemoryStore } from '../../src/store.js';
import { pubkeyRoute } from '../../src/routes/oracle/pubkey.js';
import { proveRoute } from '../../src/routes/oracle/prove.js';
import { reencryptRoute } from '../../src/routes/oracle/reencrypt.js';
import { revokeRoute } from '../../src/routes/oracle/revoke.js';
import { digestForOracleProof } from '@sovereignclaw/inft';

const FAKE_DEPLOYMENT = {
  network: '0g-galileo-testnet',
  chainId: 16602,
  deployer: '0x0000000000000000000000000000000000000abc',
  oracle: '0x0000000000000000000000000000000000000def',
  addresses: {
    AgentNFT: '0xc3f997545da4AA8E70C82Aab82ECB48722740601',
    MemoryRevocation: '0x735084C861E64923576D04d678bA2f89f6fbb6AC',
  },
  explorer: {
    AgentNFT: 'https://chainscan-galileo.0g.ai/address/0xc3f997545da4AA8E70C82Aab82ECB48722740601',
    MemoryRevocation:
      'https://chainscan-galileo.0g.ai/address/0x735084C861E64923576D04d678bA2f89f6fbb6AC',
  },
};

function makeConfig(extra: Partial<{ ORACLE_AUTH_TOKEN: string }> = {}) {
  return {
    PORT: 8787,
    ORACLE_PRIVATE_KEY: '0x' + '11'.repeat(32),
    ORACLE_AUTH_TOKEN: extra.ORACLE_AUTH_TOKEN,
    LOG_LEVEL: 'fatal' as const,
    STUDIO_SIGNATURE_MAX_DRIFT_SEC: 300,
    deployment: FAKE_DEPLOYMENT,
  };
}

function fixedKey(): ReturnType<typeof loadOracleKey> {
  return loadOracleKey('0x' + '11'.repeat(32));
}

function decodeProof(hex: string) {
  const abi = AbiCoder.defaultAbiCoder();
  return abi.decode(
    [
      'tuple(uint8 action,uint256 tokenId,address from,address to,bytes32 newPointer,bytes32 dataHash,uint256 nonce,bytes signature)',
    ],
    hex,
  )[0] as {
    action: bigint;
    tokenId: bigint;
    from: string;
    to: string;
    newPointer: string;
    dataHash: string;
    nonce: bigint;
    signature: string;
  };
}

describe('oracle routes', () => {
  it('GET /oracle/pubkey returns oracle address and binding', async () => {
    const app = new Hono().route('/oracle', pubkeyRoute({ key: fixedKey(), config: makeConfig() }));
    const r = await app.fetch(new Request('http://x/oracle/pubkey'));
    const body = (await r.json()) as { address: string; chainId: number; agentNFT: string };
    expect(r.status).toBe(200);
    expect(body.chainId).toBe(16602);
    expect(body.agentNFT.toLowerCase()).toBe(FAKE_DEPLOYMENT.addresses.AgentNFT.toLowerCase());
    expect(body.address.toLowerCase()).toBe(fixedKey().address.toLowerCase());
  });

  it('POST /oracle/prove returns a signed proof recoverable to the oracle key', async () => {
    const app = new Hono().route('/oracle', proveRoute({ key: fixedKey(), config: makeConfig() }));
    const body = {
      action: 'transfer',
      tokenId: '1',
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      newPointer: '0x' + 'aa'.repeat(32),
      dataHash: '0x' + 'bb'.repeat(32),
      nonce: '0',
    };
    const r = await app.fetch(
      new Request('http://x/oracle/prove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    const json = (await r.json()) as { proof: string };
    expect(r.status).toBe(200);
    const decoded = decodeProof(json.proof);
    const digest = digestForOracleProof(16602n, FAKE_DEPLOYMENT.addresses.AgentNFT, {
      action: 'transfer',
      tokenId: 1n,
      from: body.from,
      to: body.to,
      newPointer: body.newPointer,
      dataHash: body.dataHash,
      nonce: 0n,
    });
    const recovered = recoverAddress(digest, decoded.signature);
    expect(recovered.toLowerCase()).toBe(fixedKey().address.toLowerCase());
  });

  it('POST /oracle/prove rejects malformed bodies with 400', async () => {
    const app = new Hono().route('/oracle', proveRoute({ key: fixedKey(), config: makeConfig() }));
    const r = await app.fetch(
      new Request('http://x/oracle/prove', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'transfer' }),
      }),
    );
    expect(r.status).toBe(400);
  });

  it('POST /oracle/reencrypt returns 410 when token is in the local revoked set', async () => {
    const store = createInMemoryStore();
    store.add(7n, '0xabc');
    const app = new Hono().route(
      '/oracle',
      reencryptRoute({
        key: fixedKey(),
        config: makeConfig(),
        store,
        readAgent: async () => ({
          wrappedDEK: '0x01',
          encryptedPointer: '0x' + 'aa'.repeat(32),
          revoked: false,
        }),
      }),
    );
    const r = await app.fetch(
      new Request('http://x/oracle/reencrypt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId: '7',
          currentOwner: '0x0000000000000000000000000000000000000001',
          newOwner: '0x0000000000000000000000000000000000000002',
          newOwnerPubkey: '0x04',
        }),
      }),
    );
    expect(r.status).toBe(410);
  });

  it('POST /oracle/reencrypt mirrors on-chain revoked flag back to 410', async () => {
    const store = createInMemoryStore();
    const app = new Hono().route(
      '/oracle',
      reencryptRoute({
        key: fixedKey(),
        config: makeConfig(),
        store,
        readAgent: async () => ({
          wrappedDEK: '0x01',
          encryptedPointer: '0x' + 'aa'.repeat(32),
          revoked: true,
        }),
      }),
    );
    const r = await app.fetch(
      new Request('http://x/oracle/reencrypt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId: '7',
          currentOwner: '0x0000000000000000000000000000000000000001',
          newOwner: '0x0000000000000000000000000000000000000002',
          newOwnerPubkey: '0x04',
        }),
      }),
    );
    expect(r.status).toBe(410);
    expect(store.has(7n)).toBe(true);
  });

  it('POST /oracle/reencrypt happy path returns proof signed by oracle', async () => {
    const store = createInMemoryStore();
    const app = new Hono().route(
      '/oracle',
      reencryptRoute({
        key: fixedKey(),
        config: makeConfig(),
        store,
        readAgent: async () => ({
          wrappedDEK: '0xdeadbeef',
          encryptedPointer: '0x' + 'cc'.repeat(32),
          revoked: false,
        }),
      }),
    );
    const r = await app.fetch(
      new Request('http://x/oracle/reencrypt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId: '3',
          currentOwner: '0x0000000000000000000000000000000000000001',
          newOwner: '0x0000000000000000000000000000000000000002',
          newOwnerPubkey: '0x04',
        }),
      }),
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { newPointer: string; newWrappedDEK: string; proof: string };
    expect(body.newPointer).toBe('0x' + 'cc'.repeat(32));
    expect(body.newWrappedDEK).toBe('0xdeadbeef');
    const decoded = decodeProof(body.proof);
    expect(decoded.tokenId).toBe(3n);
    expect(Number(decoded.action)).toBe(0);
    expect(decoded.dataHash).toBe(keccak256('0xdeadbeef'));
  });

  it('POST /oracle/revoke verifies owner sig, signs proof, marks token in store', async () => {
    const store = createInMemoryStore();
    const owner = Wallet.createRandom();
    const tokenId = '11';
    const message = `SovereignClaw revocation v1\nTokenId: ${tokenId}`;
    const ownerSig = await owner.signMessage(message);
    const app = new Hono().route(
      '/oracle',
      revokeRoute({
        key: fixedKey(),
        config: makeConfig(),
        store,
        readOwner: async () => owner.address,
        readNonce: async () => 0n,
      }),
    );
    const r = await app.fetch(
      new Request('http://x/oracle/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId,
          owner: owner.address,
          ownerSig,
          oldKeyHash: '0x' + 'aa'.repeat(32),
        }),
      }),
    );
    expect(r.status).toBe(200);
    const body = (await r.json()) as { proof: string };
    const decoded = decodeProof(body.proof);
    expect(Number(decoded.action)).toBe(1);
    expect(decoded.tokenId).toBe(11n);
    expect(decoded.from.toLowerCase()).toBe(owner.address.toLowerCase());
    expect(store.has(11n)).toBe(true);
  });

  it('POST /oracle/revoke rejects when ownerSig does not match', async () => {
    const store = createInMemoryStore();
    const wallet = Wallet.createRandom();
    const other = Wallet.createRandom();
    const tokenId = '1';
    const ownerSig = await other.signMessage(`SovereignClaw revocation v1\nTokenId: ${tokenId}`);
    const app = new Hono().route(
      '/oracle',
      revokeRoute({
        key: fixedKey(),
        config: makeConfig(),
        store,
        readOwner: async () => wallet.address,
        readNonce: async () => 0n,
      }),
    );
    const r = await app.fetch(
      new Request('http://x/oracle/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId,
          owner: wallet.address,
          ownerSig,
          oldKeyHash: '0x' + 'aa'.repeat(32),
        }),
      }),
    );
    expect(r.status).toBe(401);
  });

  it('POST /oracle/revoke rejects when owner is not the on-chain owner', async () => {
    const store = createInMemoryStore();
    const wallet = Wallet.createRandom();
    const tokenId = '1';
    const ownerSig = await wallet.signMessage(`SovereignClaw revocation v1\nTokenId: ${tokenId}`);
    const app = new Hono().route(
      '/oracle',
      revokeRoute({
        key: fixedKey(),
        config: makeConfig(),
        store,
        readOwner: async () => '0x0000000000000000000000000000000000000bad',
        readNonce: async () => 0n,
      }),
    );
    const r = await app.fetch(
      new Request('http://x/oracle/revoke', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tokenId,
          owner: wallet.address,
          ownerSig,
          oldKeyHash: '0x' + 'aa'.repeat(32),
        }),
      }),
    );
    expect(r.status).toBe(401);
    expect(getBytes('0x' + 'aa'.repeat(32)).length).toBe(32);
  });
});
