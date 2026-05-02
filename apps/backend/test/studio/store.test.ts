import { describe, expect, it } from 'vitest';
import { createStudioStore } from '../../src/studio/store.js';

describe('createStudioStore', () => {
  it('creates queued jobs with unique ids', () => {
    const store = createStudioStore();
    const a = store.create('0xabc');
    const b = store.create('0xabc');
    expect(a.deployId).not.toBe(b.deployId);
    expect(a.status).toBe('queued');
    expect(a.graphSha).toBe('0xabc');
  });

  it('tracks updates and preserves logs chronologically', () => {
    const store = createStudioStore();
    const j = store.create('0x1');
    store.log(j.deployId, 'info', 'starting');
    store.update(j.deployId, { status: 'bundling' });
    store.log(j.deployId, 'info', 'bundled');
    const final = store.get(j.deployId)!;
    expect(final.status).toBe('bundling');
    expect(final.logs.map((l) => l.message)).toEqual(['deploy queued', 'starting', 'bundled']);
  });

  it('merges agent entries by nodeId', () => {
    const store = createStudioStore();
    const j = store.create('0x1');
    store.setAgent(j.deployId, { nodeId: 'a-1', role: 'planner' });
    store.setAgent(j.deployId, {
      nodeId: 'a-1',
      role: 'planner',
      tokenId: '42',
      txHash: '0xdead',
      explorerUrl: 'https://example/tx/0xdead',
    });
    const final = store.get(j.deployId)!;
    expect(final.agents).toEqual([
      {
        nodeId: 'a-1',
        role: 'planner',
        tokenId: '42',
        txHash: '0xdead',
        explorerUrl: 'https://example/tx/0xdead',
      },
    ]);
  });

  it('evicts oldest jobs beyond maxJobs', () => {
    const store = createStudioStore(3);
    const a = store.create('1');
    store.create('2');
    store.create('3');
    store.create('4');
    expect(store.get(a.deployId)).toBeUndefined();
    expect(store.size()).toBe(3);
  });

  it('throws on updating an unknown deployId', () => {
    const store = createStudioStore();
    expect(() => store.update('ghost', { status: 'done' })).toThrow(/unknown deployId/);
    expect(() => store.log('ghost', 'info', 'x')).toThrow(/unknown deployId/);
  });
});
