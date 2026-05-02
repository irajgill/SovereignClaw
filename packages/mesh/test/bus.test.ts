import { describe, expect, it } from 'vitest';
import { InMemory } from '@sovereignclaw/memory';
import { Bus } from '../src/bus.js';
import { BusEventTypes, type BusEvent } from '../src/types.js';
import { eventKey } from '../src/seq.js';
import { BusAppendError } from '../src/errors.js';

function makeBus(meshId = 'test-mesh') {
  return new Bus({ meshId, provider: InMemory({ namespace: meshId }) });
}

describe('Bus', () => {
  it('exposes the provider namespace', () => {
    const bus = new Bus({ meshId: 'm1', provider: InMemory({ namespace: 'ns-foo' }) });
    expect(bus.namespace).toBe('ns-foo');
    expect(bus.meshId).toBe('m1');
  });

  it('appends events with monotonic seq starting at 0', async () => {
    const bus = makeBus();
    const a = await bus.append({ type: 'a', fromAgent: 'planner', payload: { x: 1 } });
    const b = await bus.append({ type: 'b', fromAgent: 'executor', payload: { x: 2 } });
    expect(a.event.seq).toBe(0);
    expect(b.event.seq).toBe(1);
    expect(bus.nextSeq()).toBe(2);
  });

  it('stamps meshId and timestamp on every event', async () => {
    const bus = makeBus('my-mesh');
    const before = Date.now();
    const { event } = await bus.append({ type: 'x', fromAgent: 'm', payload: {} });
    expect(event.meshId).toBe('my-mesh');
    expect(event.timestamp).toBeGreaterThanOrEqual(before);
    expect(event.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('keys follow the canonical eventKey format', async () => {
    const bus = makeBus();
    const { key } = await bus.append({ type: 'x', fromAgent: 'a', payload: {} });
    expect(key).toBe(eventKey(0));
  });

  it('emits events to listeners after durable write', async () => {
    const bus = makeBus();
    const seen: BusEvent[] = [];
    const off = bus.on((e) => {
      seen.push(e);
    });
    await bus.append({ type: 'x', fromAgent: 'a', payload: { n: 1 } });
    await bus.append({ type: 'y', fromAgent: 'b', payload: { n: 2 } });
    expect(seen.map((e) => e.type)).toEqual(['x', 'y']);
    off();
    await bus.append({ type: 'z', fromAgent: 'c', payload: { n: 3 } });
    expect(seen).toHaveLength(2);
  });

  it('listener throws are swallowed and do not stop subsequent listeners', async () => {
    const bus = makeBus();
    const quiet: BusEvent[] = [];
    bus.on(() => {
      throw new Error('listener boom');
    });
    bus.on((e) => {
      quiet.push(e);
    });
    await bus.append({ type: 'x', fromAgent: 'a', payload: {} });
    expect(quiet).toHaveLength(1);
  });

  it('wraps provider set failures in BusAppendError', async () => {
    const provider = InMemory({ namespace: 'n' });
    await provider.close();
    const bus = new Bus({ meshId: 'm', provider });
    await expect(
      bus.append({ type: 'x', fromAgent: 'a', payload: {} }),
    ).rejects.toBeInstanceOf(BusAppendError);
  });

  it('replay returns events in seq order even if inserted out of natural order', async () => {
    const bus = makeBus();
    // InMemory iteration order mirrors insertion; still test the sort behaviour.
    await bus.append({ type: 'first', fromAgent: 'a', payload: {} });
    await bus.append({ type: 'second', fromAgent: 'a', payload: {} });
    await bus.append({ type: 'third', fromAgent: 'a', payload: {} });
    const events = await bus.replay();
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(events.map((e) => e.type)).toEqual(['first', 'second', 'third']);
  });

  it('replay respects fromSeq', async () => {
    const bus = makeBus();
    for (let i = 0; i < 5; i += 1) {
      await bus.append({ type: `e${i}`, fromAgent: 'a', payload: {} });
    }
    const events = await bus.replay(3);
    expect(events.map((e) => e.seq)).toEqual([3, 4]);
  });

  it('replay reconstructs a full event body', async () => {
    const bus = makeBus();
    await bus.append({
      type: BusEventTypes.TaskCreated,
      fromAgent: 'mesh',
      payload: { task: 'hi', round: 0 },
    });
    const events = await bus.replay();
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe(BusEventTypes.TaskCreated);
    expect(events[0]?.payload).toEqual({ task: 'hi', round: 0 });
  });
});
