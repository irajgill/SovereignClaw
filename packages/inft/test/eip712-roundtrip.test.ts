import { describe, it, expect } from 'vitest';
import { Wallet, getBytes, keccak256, recoverAddress, Signature, toUtf8Bytes } from 'ethers';
import type { OracleAction } from '../src/eip712.js';
import {
  ORACLE_PROOF_TYPEHASH,
  DOMAIN_TYPEHASH,
  DOMAIN_NAME_HASH,
  DOMAIN_VERSION_HASH,
  ORACLE_PROOF_TYPE_LITERAL,
  DOMAIN_TYPE_LITERAL,
  DOMAIN_NAME_LITERAL,
  DOMAIN_VERSION_LITERAL,
  FIXTURE,
  digestForOracleProof,
  encodeOracleProof,
  computeDomainSeparator,
  assertTypeHashesMatchFixture,
} from '../src/eip712.js';

describe('eip712 typehash byte-equality with foundry-emitted fixture', () => {
  it('local TS hashes equal fixture hashes', () => {
    expect(ORACLE_PROOF_TYPEHASH).toEqual(FIXTURE.ORACLE_PROOF_TYPEHASH);
    expect(DOMAIN_TYPEHASH).toEqual(FIXTURE.DOMAIN_TYPEHASH);
    expect(DOMAIN_NAME_HASH).toEqual(FIXTURE.DOMAIN_NAME_HASH);
    expect(DOMAIN_VERSION_HASH).toEqual(FIXTURE.DOMAIN_VERSION_HASH);
  });

  it('canonical type literals match the fixture literals', () => {
    expect(ORACLE_PROOF_TYPE_LITERAL).toEqual(FIXTURE.ORACLE_PROOF_TYPE_LITERAL);
    expect(DOMAIN_NAME_LITERAL).toEqual(FIXTURE.DOMAIN_NAME_LITERAL);
    expect(DOMAIN_VERSION_LITERAL).toEqual(FIXTURE.DOMAIN_VERSION_LITERAL);
  });

  it('assertTypeHashesMatchFixture() does not throw', () => {
    expect(() => assertTypeHashesMatchFixture()).not.toThrow();
  });

  it('DOMAIN_TYPE_LITERAL hashes to DOMAIN_TYPEHASH', () => {
    // Sanity: the only thing the fixture doesn't carry is the EIP712Domain
    // type literal. Verify it canonicalizes to the DOMAIN_TYPEHASH the contract
    // and fixture both store.
    expect(keccak256(toUtf8Bytes(DOMAIN_TYPE_LITERAL))).toEqual(DOMAIN_TYPEHASH);
  });
});

describe('eip712 digest sign/recover roundtrip', () => {
  const chainId = 16602n;
  const verifyingContract = '0xc3f997545da4AA8E70C82Aab82ECB48722740601';

  it('a digest signed locally recovers to the signer', async () => {
    const wallet = Wallet.createRandom();
    const fields = {
      action: 'transfer' as const,
      tokenId: 7n,
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      newPointer: '0x' + 'aa'.repeat(32),
      dataHash: '0x' + 'bb'.repeat(32),
      nonce: 0n,
    };
    const digest = digestForOracleProof(chainId, verifyingContract, fields);
    const sig = wallet.signingKey.sign(getBytes(digest));
    const serialized = Signature.from(sig).serialized;
    const recovered = recoverAddress(digest, serialized);
    expect(recovered.toLowerCase()).toEqual(wallet.address.toLowerCase());
  });

  it('digest is sensitive to every field (changing any one breaks recovery)', async () => {
    const wallet = Wallet.createRandom();
    interface Fields {
      action: OracleAction;
      tokenId: bigint;
      from: string;
      to: string;
      newPointer: string;
      dataHash: string;
      nonce: bigint;
    }
    const base: Fields = {
      action: 'transfer',
      tokenId: 7n,
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      newPointer: '0x' + 'aa'.repeat(32),
      dataHash: '0x' + 'bb'.repeat(32),
      nonce: 0n,
    };
    const baseDigest = digestForOracleProof(chainId, verifyingContract, base);
    const sig = Signature.from(wallet.signingKey.sign(getBytes(baseDigest))).serialized;

    const tamperPaths: Array<Partial<Fields>> = [
      { tokenId: 8n },
      { from: '0x0000000000000000000000000000000000000003' },
      { to: '0x0000000000000000000000000000000000000004' },
      { newPointer: '0x' + 'cc'.repeat(32) },
      { dataHash: '0x' + 'dd'.repeat(32) },
      { nonce: 1n },
      { action: 'revoke' },
    ];
    for (const tamper of tamperPaths) {
      const tampered: Fields = { ...base, ...tamper };
      const tamperedDigest = digestForOracleProof(chainId, verifyingContract, tampered);
      const recovered = recoverAddress(tamperedDigest, sig);
      expect(recovered.toLowerCase()).not.toEqual(wallet.address.toLowerCase());
    }
  });

  it('domain separator is sensitive to chainId and verifyingContract', () => {
    const ds1 = computeDomainSeparator(16602n, verifyingContract);
    const ds2 = computeDomainSeparator(1n, verifyingContract);
    const ds3 = computeDomainSeparator(16602n, '0x0000000000000000000000000000000000000001');
    expect(ds1).not.toEqual(ds2);
    expect(ds1).not.toEqual(ds3);
    expect(ds2).not.toEqual(ds3);
  });
});

describe('encodeOracleProof byte shape', () => {
  it('produces a single-tuple ABI encoding the contract can abi.decode', () => {
    const fields = {
      action: 'transfer' as const,
      tokenId: 1n,
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      newPointer: '0x' + 'aa'.repeat(32),
      dataHash: '0x' + 'bb'.repeat(32),
      nonce: 0n,
    };
    const sig = '0x' + '11'.repeat(65);
    const encoded = encodeOracleProof(fields, sig);
    expect(encoded).toMatch(/^0x[0-9a-f]+$/);
    // 8 fields × 32 bytes head pointers + tail data; sanity check it's
    // long enough for the static fields plus dynamic signature.
    expect(encoded.length).toBeGreaterThan(2 + 8 * 64);
  });
});
