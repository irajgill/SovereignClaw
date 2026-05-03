import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Wallet, keccak256 } from 'ethers';
import type { Deployment } from '../src/deployment.js';

vi.mock('../src/contracts.js', () => {
  const calls: Array<unknown[]> = [];
  let revokeImpl: ((...args: unknown[]) => Promise<{ wait: () => Promise<unknown> }>) | undefined;
  let getAgentImpl: (() => Promise<{ wrappedDEK: string }>) | undefined;
  let getAgentThrows: Error | undefined;

  return {
    __setRevokeImpl: (fn: typeof revokeImpl) => {
      revokeImpl = fn;
    },
    __setGetAgent: (fn: typeof getAgentImpl, throws?: Error) => {
      getAgentImpl = fn;
      getAgentThrows = throws;
    },
    __revokeCalls: calls,
    getAgentNFT: () => ({
      getAgent: async () => {
        if (getAgentThrows) throw getAgentThrows;
        if (!getAgentImpl) throw new Error('getAgent not set');
        return getAgentImpl();
      },
      revoke: async (...a: unknown[]) => {
        calls.push(a);
        if (!revokeImpl) throw new Error('revoke impl not set');
        return revokeImpl(...a);
      },
    }),
    explorerTxUrl: (base: string, h: string) => `${base}/tx/${h}`,
    explorerAddressUrl: (base: string, a: string) => `${base}/address/${a}`,
  };
});

import { OracleClient, revokeMemory, RevokeError } from '../src/index.js';
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

beforeEach(() => {
  mocks.__revokeCalls.length = 0;
});

describe('revokeMemory', () => {
  it('reads on-chain DEK, asks oracle, submits with the proof', async () => {
    const owner = Wallet.createRandom();
    const ownerAddr = await owner.getAddress();
    const onChainDek = '0xdeadbeefcafef00d';
    const expectedKeyHash = keccak256(onChainDek);

    const oracle = new OracleClient({ url: 'http://oracle.test' });
    const revokeSpy = vi.spyOn(oracle, 'revoke').mockResolvedValue({ proof: '0xabc' });

    mocks.__setGetAgent(async () => ({ wrappedDEK: onChainDek }));
    mocks.__setRevokeImpl(async () => ({
      wait: async () => ({ hash: '0xfeed', blockNumber: 1, logs: [] }),
    }));

    const r = await revokeMemory({ tokenId: 9n, owner, oracle, deployment: FAKE_DEPLOYMENT });

    expect(revokeSpy).toHaveBeenCalled();
    const callArg = revokeSpy.mock.calls[0]![0]!;
    expect(callArg.tokenId).toBe('9');
    expect(callArg.owner).toBe(ownerAddr);
    expect(callArg.oldKeyHash).toBe(expectedKeyHash);
    expect(typeof callArg.ownerSig).toBe('string');
    expect(mocks.__revokeCalls).toHaveLength(1);
    const args = mocks.__revokeCalls[0]!;
    expect(args[0]).toBe(9n);
    expect(args[1]).toBe(expectedKeyHash);
    expect(args[2]).toBe('0xabc');
    expect(r.txHash).toBe('0xfeed');
    expect(r.oldKeyHash).toBe(expectedKeyHash);
  });

  it('throws RevokeError when on-chain DEK read fails', async () => {
    const owner = Wallet.createRandom();
    const oracle = new OracleClient({ url: 'http://oracle.test' });
    mocks.__setGetAgent(undefined, new Error('rpc out'));
    await expect(
      revokeMemory({ tokenId: 1n, owner, oracle, deployment: FAKE_DEPLOYMENT }),
    ).rejects.toBeInstanceOf(RevokeError);
  });

  it('fires onPhase hook in order and returns matching timings', async () => {
    const owner = Wallet.createRandom();
    const oracle = new OracleClient({ url: 'http://oracle.test' });
    vi.spyOn(oracle, 'revoke').mockResolvedValue({ proof: '0xabc' });
    mocks.__setGetAgent(async () => ({ wrappedDEK: '0xdeadbeef' }));
    mocks.__setRevokeImpl(async () => ({
      wait: async () => ({ hash: '0xfeed', blockNumber: 1, logs: [] }),
    }));

    const seen: Array<{ phase: string; atMs: number }> = [];
    const r = await revokeMemory({
      tokenId: 7n,
      owner,
      oracle,
      deployment: FAKE_DEPLOYMENT,
      onPhase: (phase, atMs) => seen.push({ phase, atMs }),
    });

    expect(seen.map((s) => s.phase)).toEqual([
      'started',
      'signed',
      'oracle-refused',
      'chain-submitted',
      'chain-confirmed',
    ]);
    // Timings are monotonically non-decreasing and match the hook.
    const phases = [
      'started',
      'signed',
      'oracle-refused',
      'chain-submitted',
      'chain-confirmed',
    ] as const;
    for (let i = 1; i < phases.length; i++) {
      expect(r.timings[phases[i]!]).toBeGreaterThanOrEqual(r.timings[phases[i - 1]!]);
    }
    for (const s of seen) {
      expect(r.timings[s.phase as (typeof phases)[number]]).toBe(s.atMs);
    }
  });

  it('swallows errors thrown from onPhase so the revoke still succeeds', async () => {
    const owner = Wallet.createRandom();
    const oracle = new OracleClient({ url: 'http://oracle.test' });
    vi.spyOn(oracle, 'revoke').mockResolvedValue({ proof: '0xabc' });
    mocks.__setGetAgent(async () => ({ wrappedDEK: '0xdeadbeef' }));
    mocks.__setRevokeImpl(async () => ({
      wait: async () => ({ hash: '0xfeed', blockNumber: 1, logs: [] }),
    }));

    const r = await revokeMemory({
      tokenId: 8n,
      owner,
      oracle,
      deployment: FAKE_DEPLOYMENT,
      onPhase: () => {
        throw new Error('boom');
      },
    });
    expect(r.txHash).toBe('0xfeed');
    expect(r.timings.started).toBeLessThanOrEqual(r.timings['chain-confirmed']);
  });
});
