import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Wallet } from 'ethers';
import type { Deployment } from '../src/deployment.js';

vi.mock('../src/contracts.js', () => {
  const calls: Array<unknown[]> = [];
  let impl: ((...args: unknown[]) => Promise<{ wait: () => Promise<unknown> }>) | undefined;

  return {
    __setMintImpl: (fn: typeof impl) => {
      impl = fn;
    },
    __mintCalls: calls,
    getAgentNFT: () => ({
      mint: async (...a: unknown[]) => {
        calls.push(a);
        if (!impl) throw new Error('mint impl not set');
        return impl(...a);
      },
    }),
    explorerTxUrl: (base: string, h: string) => `${base}/tx/${h}`,
    explorerAddressUrl: (base: string, a: string) => `${base}/address/${a}`,
  };
});

import { mintAgentNFT, MintError, computeMetadataHash } from '../src/index.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mocks = (await import('../src/contracts.js')) as any;

const FAKE_DEPLOYMENT: Deployment = {
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

const VALID_POINTER = '0x' + 'a1'.repeat(32);

function makeReceipt(args: {
  tokenId: bigint;
  ownerAddr: string;
  hash: string;
  blockNumber?: number;
}) {
  return {
    hash: args.hash,
    blockNumber: args.blockNumber ?? 1234,
    logs: [
      {
        eventName: 'Minted',
        args: {
          getValue: (k: string) => {
            if (k === 'tokenId') return args.tokenId;
            if (k === 'owner') return args.ownerAddr;
            return undefined;
          },
        },
      },
    ],
  };
}

beforeEach(() => {
  mocks.__mintCalls.length = 0;
});

describe('mintAgentNFT', () => {
  it('happy path: validates inputs, calls mint, returns parsed result', async () => {
    const owner = Wallet.createRandom();
    const ownerAddr = await owner.getAddress();
    const agent = { role: 'researcher', getPointer: () => VALID_POINTER };
    mocks.__setMintImpl(async () => ({
      wait: async () => makeReceipt({ tokenId: 42n, ownerAddr, hash: '0xdeadbeef' }),
    }));

    const result = await mintAgentNFT({
      agent,
      owner,
      royaltyBps: 500,
      wrappedDEK: new Uint8Array([1, 2, 3]),
      deployment: FAKE_DEPLOYMENT,
    });

    expect(result.tokenId).toBe(42n);
    expect(result.txHash).toBe('0xdeadbeef');
    expect(result.explorerUrl).toContain('tx/0xdeadbeef');
    expect(result.encryptedPointer).toBe(VALID_POINTER);
    expect(result.metadataHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(mocks.__mintCalls).toHaveLength(1);
    const args = mocks.__mintCalls[0]!;
    expect(args[0]).toBe(ownerAddr);
    expect(args[1]).toBe('researcher');
    expect(args[3]).toBe(VALID_POINTER);
    expect(args[4]).toBe('0x010203');
    expect(args[5]).toBe(500);
  });

  it('rejects oversize role', async () => {
    const owner = Wallet.createRandom();
    const role = 'x'.repeat(65);
    const agent = { role, getPointer: () => VALID_POINTER };
    await expect(
      mintAgentNFT({ agent, owner, deployment: FAKE_DEPLOYMENT }),
    ).rejects.toBeInstanceOf(MintError);
  });

  it('rejects oversize wrappedDEK', async () => {
    const owner = Wallet.createRandom();
    const agent = { role: 'r', getPointer: () => VALID_POINTER };
    const big = new Uint8Array(2049);
    await expect(
      mintAgentNFT({ agent, owner, deployment: FAKE_DEPLOYMENT, wrappedDEK: big }),
    ).rejects.toBeInstanceOf(MintError);
  });

  it('rejects royaltyBps > 10000', async () => {
    const owner = Wallet.createRandom();
    const agent = { role: 'r', getPointer: () => VALID_POINTER };
    await expect(
      mintAgentNFT({ agent, owner, royaltyBps: 10_001, deployment: FAKE_DEPLOYMENT }),
    ).rejects.toBeInstanceOf(MintError);
  });

  it('rejects pointer that is not bytes32', async () => {
    const owner = Wallet.createRandom();
    const agent = { role: 'r', getPointer: () => '0xdead' };
    await expect(
      mintAgentNFT({ agent, owner, deployment: FAKE_DEPLOYMENT }),
    ).rejects.toBeInstanceOf(MintError);
  });

  it('calls agent.flush() before reading pointer', async () => {
    const owner = Wallet.createRandom();
    const ownerAddr = await owner.getAddress();
    const seq: string[] = [];
    const agent = {
      role: 'r',
      flush: async () => {
        seq.push('flush');
      },
      getPointer: () => {
        seq.push('getPointer');
        return VALID_POINTER;
      },
    };
    mocks.__setMintImpl(async () => ({
      wait: async () => makeReceipt({ tokenId: 1n, ownerAddr, hash: '0x1' }),
    }));
    await mintAgentNFT({ agent, owner, deployment: FAKE_DEPLOYMENT });
    expect(seq).toEqual(['flush', 'getPointer']);
  });
});

describe('computeMetadataHash', () => {
  it('is deterministic and changes when any input changes', () => {
    const base = {
      role: 'researcher',
      pointer: VALID_POINTER,
      owner: '0x0000000000000000000000000000000000000001',
      royaltyBps: 500,
    };
    const h0 = computeMetadataHash(base);
    expect(computeMetadataHash(base)).toBe(h0);
    expect(computeMetadataHash({ ...base, role: 'closer' })).not.toBe(h0);
    expect(computeMetadataHash({ ...base, royaltyBps: 0 })).not.toBe(h0);
    expect(
      computeMetadataHash({ ...base, owner: '0x0000000000000000000000000000000000000002' }),
    ).not.toBe(h0);
  });
});
