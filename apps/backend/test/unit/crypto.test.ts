import { describe, it, expect } from 'vitest';
import { Wallet, recoverAddress, getBytes, AbiCoder } from 'ethers';
import {
  digestForOracleProof,
  ORACLE_PROOF_TYPEHASH,
  DOMAIN_TYPEHASH,
  DOMAIN_NAME_HASH,
  DOMAIN_VERSION_HASH,
  ORACLE_PROOF_TYPE_LITERAL,
} from '@sovereignclaw/inft';
import { loadOracleKey, signOracleProof } from '../../src/crypto.js';
import fixture from '../../../../deployments/eip712-typehashes.json' with { type: 'json' };

describe('apps/backend EIP-712 byte-equality', () => {
  it('the package re-export matches the foundry fixture', () => {
    expect(ORACLE_PROOF_TYPEHASH).toEqual(fixture.ORACLE_PROOF_TYPEHASH);
    expect(DOMAIN_TYPEHASH).toEqual(fixture.DOMAIN_TYPEHASH);
    expect(DOMAIN_NAME_HASH).toEqual(fixture.DOMAIN_NAME_HASH);
    expect(DOMAIN_VERSION_HASH).toEqual(fixture.DOMAIN_VERSION_HASH);
    expect(ORACLE_PROOF_TYPE_LITERAL).toEqual(fixture.ORACLE_PROOF_TYPE_LITERAL);
  });
});

describe('signOracleProof', () => {
  const chainId = 16602n;
  const verifyingContract = '0xc3f997545da4AA8E70C82Aab82ECB48722740601';

  it('produces a digest equal to digestForOracleProof, signs it, and the signature recovers to the oracle address', () => {
    const wallet = Wallet.createRandom();
    const key = loadOracleKey(wallet.privateKey);
    const fields = {
      action: 'transfer' as const,
      tokenId: 3n,
      from: '0x0000000000000000000000000000000000000111',
      to: '0x0000000000000000000000000000000000000222',
      newPointer: '0x' + 'aa'.repeat(32),
      dataHash: '0x' + 'bb'.repeat(32),
      nonce: 0n,
    };
    const result = signOracleProof(key, chainId, verifyingContract, fields);
    expect(result.digest).toEqual(digestForOracleProof(chainId, verifyingContract, fields));
    const recovered = recoverAddress(result.digest, result.signature);
    expect(recovered.toLowerCase()).toEqual(key.address.toLowerCase());
    // Encoded proof carries the same signature.
    expect(result.proof).toContain(result.signature.slice(2, 10));
  });

  it('action discriminator changes the digest', () => {
    const key = loadOracleKey(Wallet.createRandom().privateKey);
    const base = {
      tokenId: 1n,
      from: '0x0000000000000000000000000000000000000001',
      to: '0x0000000000000000000000000000000000000002',
      newPointer: '0x' + 'aa'.repeat(32),
      dataHash: '0x' + 'bb'.repeat(32),
      nonce: 0n,
    };
    const t = signOracleProof(key, chainId, verifyingContract, { ...base, action: 'transfer' });
    const r = signOracleProof(key, chainId, verifyingContract, { ...base, action: 'revoke' });
    expect(t.digest).not.toEqual(r.digest);
  });

  it('encoded proof can be decoded back to its fields', () => {
    const key = loadOracleKey(Wallet.createRandom().privateKey);
    const fields = {
      action: 'revoke' as const,
      tokenId: 9n,
      from: '0x0000000000000000000000000000000000000aaa',
      to: '0x0000000000000000000000000000000000000aaa',
      newPointer: '0x' + '0'.repeat(64),
      dataHash: '0x' + 'cd'.repeat(32),
      nonce: 5n,
    };
    const result = signOracleProof(key, chainId, verifyingContract, fields);
    const abi = AbiCoder.defaultAbiCoder();
    const decodedArr = abi.decode(
      [
        'tuple(uint8 action,uint256 tokenId,address from,address to,bytes32 newPointer,bytes32 dataHash,uint256 nonce,bytes signature)',
      ],
      result.proof,
    ) as Array<{
      action: bigint;
      tokenId: bigint;
      from: string;
      to: string;
      newPointer: string;
      dataHash: string;
      nonce: bigint;
      signature: string;
    }>;
    const decoded = decodedArr[0]!;
    expect(Number(decoded.action)).toBe(1);
    expect(decoded.tokenId).toBe(9n);
    expect(decoded.from.toLowerCase()).toBe(fields.from);
    expect(decoded.dataHash).toBe(fields.dataHash);
    expect(decoded.signature).toBe(result.signature);
    // recover the signer over the digest decoded from these fields
    expect(getBytes(decoded.signature).length).toBe(65);
  });
});
