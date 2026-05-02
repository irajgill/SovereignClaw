import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Wallet } from 'ethers';
import type { Deployment } from '../src/deployment.js';

vi.mock('../src/contracts.js', () => {
  const calls: Array<unknown[]> = [];
  let impl: ((...args: unknown[]) => Promise<{ wait: () => Promise<unknown> }>) | undefined;

  return {
    __setTransferImpl: (fn: typeof impl) => {
      impl = fn;
    },
    __transferCalls: calls,
    getAgentNFT: () => ({
      transferWithReencryption: async (...a: unknown[]) => {
        calls.push(a);
        if (!impl) throw new Error('transfer impl not set');
        return impl(...a);
      },
    }),
    explorerTxUrl: (base: string, h: string) => `${base}/tx/${h}`,
    explorerAddressUrl: (base: string, a: string) => `${base}/address/${a}`,
  };
});

import { OracleClient, transferAgentNFT, TransferError } from '../src/index.js';
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

const VALID_POINTER = '0x' + 'b2'.repeat(32);

beforeEach(() => {
  mocks.__transferCalls.length = 0;
});

describe('transferAgentNFT', () => {
  it('calls oracle.reencrypt with the right body, then submits with the proof unchanged', async () => {
    const from = Wallet.createRandom();
    const fromAddress = await from.getAddress();
    const to = Wallet.createRandom().address;
    const newOwnerPubkey = '0x04' + 'aa'.repeat(64);

    const oracle = new OracleClient({ url: 'http://oracle.test' });
    const reencryptSpy = vi.spyOn(oracle, 'reencrypt').mockResolvedValue({
      newPointer: VALID_POINTER,
      newWrappedDEK: '0xdeadbeef',
      proof: '0xabcdef',
    });

    mocks.__setTransferImpl(async () => ({
      wait: async () => ({ hash: '0xfeedbeef', blockNumber: 1, logs: [] }),
    }));

    const r = await transferAgentNFT({
      tokenId: 7n,
      from,
      to,
      newOwnerPubkey,
      oracle,
      deployment: FAKE_DEPLOYMENT,
    });

    expect(reencryptSpy).toHaveBeenCalledWith({
      tokenId: '7',
      currentOwner: fromAddress,
      newOwner: to,
      newOwnerPubkey,
    });
    expect(mocks.__transferCalls).toHaveLength(1);
    const args = mocks.__transferCalls[0]!;
    expect(args[0]).toBe(to);
    expect(args[1]).toBe(7n);
    expect(args[2]).toBe(VALID_POINTER);
    expect(args[3]).toBe('0xdeadbeef');
    expect(args[4]).toBe('0xabcdef');
    expect(r.txHash).toBe('0xfeedbeef');
    expect(r.newPointer).toBe(VALID_POINTER);
  });

  it('rejects an invalid `to` address', async () => {
    const oracle = new OracleClient({ url: 'http://oracle.test' });
    await expect(
      transferAgentNFT({
        tokenId: 1n,
        from: Wallet.createRandom(),
        to: 'not-an-address',
        newOwnerPubkey: '0x04',
        oracle,
        deployment: FAKE_DEPLOYMENT,
      }),
    ).rejects.toBeInstanceOf(TransferError);
  });

  it('rejects an oracle reply with a malformed pointer', async () => {
    const oracle = new OracleClient({ url: 'http://oracle.test' });
    vi.spyOn(oracle, 'reencrypt').mockResolvedValue({
      newPointer: '0xdeadbeef',
      newWrappedDEK: '0x01',
      proof: '0x02',
    });
    await expect(
      transferAgentNFT({
        tokenId: 1n,
        from: Wallet.createRandom(),
        to: '0x' + '1'.repeat(40),
        newOwnerPubkey: '0x04',
        oracle,
        deployment: FAKE_DEPLOYMENT,
      }),
    ).rejects.toBeInstanceOf(TransferError);
  });
});
