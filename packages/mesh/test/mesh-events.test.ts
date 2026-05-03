/**
 * Phase B PR2 unit tests for the MeshEvent surface.
 *
 * Uses fake inference adapters to deterministically exercise the event
 * sequence — no network. The adapters honor `runOpts.onChunk` to simulate
 * the streaming path so we can assert on `agent.thinking.token` events.
 */
import { describe, expect, it } from 'vitest';
import {
  Agent,
  type InferenceAdapter,
  type InferenceResult,
  type RunOptions,
} from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';
import { Mesh } from '../src/mesh.js';
import { sequentialPattern } from '../src/patterns/sequential.js';
import type { MeshEvent } from '../src/mesh-events.js';

/**
 * A fake adapter whose `run()` honors `onChunk` for streaming. When the
 * caller passes `stream: true, onChunk: ...`, we emit the full text as N
 * token chunks (one word at a time) and a `done` chunk at the end. When
 * the caller doesn't ask for streaming, we just resolve with the full
 * InferenceResult — no chunks emitted.
 */
function streamingScripted(text: string, role: string): InferenceAdapter {
  return {
    async run(_messages, opts?: RunOptions): Promise<InferenceResult> {
      const result: InferenceResult = {
        model: 'fake',
        text,
        usage: { promptTokens: 0, completionTokens: text.split(/\s+/).length, totalTokens: 0 },
        attestation: { teeVerified: true, providerAddress: null, requestId: `fake-${role}` },
        billing: { inputCost: 0n, outputCost: 0n, totalCost: 0n },
        latencyMs: 1,
        raw: {},
      };
      if (opts?.stream && opts.onChunk) {
        const words = text.split(/(\s+)/).filter((w) => w.length > 0);
        for (const w of words) {
          opts.onChunk({ type: 'token', text: w });
        }
        opts.onChunk({
          type: 'done',
          usage: result.usage,
          attestation: result.attestation,
          billing: result.billing,
          text,
          raw: [],
        });
      }
      return result;
    },
  };
}

function makeAgent(role: string, text: string): Agent {
  return new Agent({ role, inference: streamingScripted(text, role) });
}

function meshFor(testName: string): Mesh {
  return new Mesh({
    meshId: `mesh-events-${testName}-${Date.now()}`,
    provider: InMemory({ namespace: `mesh-events-${testName}-${Date.now()}` }),
  });
}

describe('Mesh.onEvent + dispatch (Phase B PR2)', () => {
  it('emits the expected MeshEvent sequence for a 2-agent sequential dispatch', async () => {
    const mesh = meshFor('sequence');
    const planner = makeAgent('planner', 'plan one');
    const executor = makeAgent('executor', 'exec two');
    mesh.register(planner).register(executor);

    const events: MeshEvent[] = [];
    const unsub = mesh.onEvent((e) => events.push(e));

    // The event sequence is what we're asserting; pass through the test.
    // Use a non-streaming run path by calling agent.run directly inside the
    // pattern — the streaming events fire only when the consumer passes
    // onChunk to the agent. Since sequentialPattern doesn't, we verify the
    // outer-shell events (task.*, agent.outcome) here.
    const result = await mesh.dispatch(
      'go',
      sequentialPattern({ agentNames: ['planner', 'executor'] }),
    );
    expect(result.finalOutput).toBe('exec two');

    unsub();
    await mesh.close();

    // Filter to the event types we care about; assert order.
    const types = events.map((e) => e.type);
    // First and last must be task.created / task.complete.
    expect(types[0]).toBe('task.created');
    expect(types[types.length - 1]).toBe('task.complete');

    // Agent outcomes fire in order: planner first, executor second.
    const outcomes = events.filter(
      (e): e is Extract<MeshEvent, { type: 'agent.outcome' }> => e.type === 'agent.outcome',
    );
    expect(outcomes.map((o) => o.agentRole)).toEqual(['planner', 'executor']);

    // taskId is consistent across all events.
    const taskIds = new Set(
      events
        .map((e) => ('taskId' in e ? e.taskId : null))
        .filter((t): t is string => typeof t === 'string'),
    );
    expect(taskIds.size).toBe(1);
  });

  it('emits agent.thinking.{start,token,end} when an agent runs in streaming mode', async () => {
    // Run two streaming agents wrapped manually inside dispatch — one passes
    // onChunk so the agent emits the streaming-flavor events. We then assert
    // the order: task.created → thinking.start → ≥1 thinking.token →
    // thinking.end → outcome → handoff → start (agent2) → tokens → end →
    // outcome → task.complete.
    const mesh = meshFor('streaming');
    const a1 = makeAgent('alpha', 'hello world');
    const a2 = makeAgent('beta', 'goodbye now');
    mesh.register(a1).register(a2);

    const events: MeshEvent[] = [];
    mesh.onEvent((e) => events.push(e));

    await mesh.dispatch('start', async () => {
      // Manual two-step pattern that streams both agents.
      await mesh.get('alpha')!.run('go', { onChunk: () => undefined });
      await mesh.get('beta')!.run('go', { onChunk: () => undefined });
      return { finalOutput: 'goodbye now' };
    });

    await mesh.close();

    const types = events.map((e) => e.type);
    // Sanity: at least one of each thinking phase per agent.
    expect(types.filter((t) => t === 'agent.thinking.start')).toHaveLength(2);
    expect(types.filter((t) => t === 'agent.thinking.end')).toHaveLength(2);
    expect(types.filter((t) => t === 'agent.thinking.token').length).toBeGreaterThanOrEqual(2);

    // Order: alpha's start precedes alpha's tokens precede alpha's end
    // precedes beta's start. And the handoff fires between alpha's end and
    // beta's start (or specifically: just before beta's start).
    const alphaStart = types.indexOf('agent.thinking.start');
    const alphaEnd = types.indexOf('agent.thinking.end');
    const handoff = types.indexOf('agent.handoff');
    const betaStart = types.lastIndexOf('agent.thinking.start');
    expect(alphaStart).toBeLessThan(alphaEnd);
    expect(alphaEnd).toBeLessThan(handoff);
    expect(handoff).toBeLessThan(betaStart);

    // The handoff carries fromRole=alpha, toRole=beta.
    const handoffEvt = events[handoff];
    if (handoffEvt?.type !== 'agent.handoff') throw new Error('expected agent.handoff');
    expect(handoffEvt.fromRole).toBe('alpha');
    expect(handoffEvt.toRole).toBe('beta');

    // task.complete carries the final agent's text.
    const last = events[events.length - 1];
    if (last?.type !== 'task.complete') throw new Error('expected task.complete last');
    expect(last.finalOutput).toBe('goodbye now');
  });

  it('the unsubscribe function stops further event delivery', async () => {
    const mesh = meshFor('unsub');
    mesh.register(makeAgent('only', 'hi'));

    const events: MeshEvent[] = [];
    const unsub = mesh.onEvent((e) => events.push(e));

    // First dispatch: subscriber receives events.
    await mesh.dispatch('go', sequentialPattern({ agentNames: ['only'] }));
    const countBeforeUnsub = events.length;
    expect(countBeforeUnsub).toBeGreaterThan(0);

    unsub();

    // Second dispatch: subscriber should receive zero new events.
    await mesh.dispatch('go again', sequentialPattern({ agentNames: ['only'] }));
    expect(events.length).toBe(countBeforeUnsub);

    await mesh.close();
  });

  it('a thrown agent error emits task.error and propagates without uncaught exceptions', async () => {
    const failingAdapter: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        throw new Error('boom');
      },
    };
    const mesh = meshFor('error');
    mesh.register(new Agent({ role: 'broken', inference: failingAdapter }));

    const events: MeshEvent[] = [];
    mesh.onEvent((e) => events.push(e));

    await expect(
      mesh.dispatch('go', sequentialPattern({ agentNames: ['broken'] })),
    ).rejects.toThrowError('boom');

    await mesh.close();

    const types = events.map((e) => e.type);
    expect(types[0]).toBe('task.created');
    expect(types[types.length - 1]).toBe('task.error');
    const errEvt = events[events.length - 1];
    if (errEvt?.type !== 'task.error') throw new Error('expected task.error last');
    expect(errEvt.error.message).toBe('boom');
  });

  it('a buggy subscriber does not abort sibling subscribers or the dispatch', async () => {
    const mesh = meshFor('buggy-sub');
    mesh.register(makeAgent('only', 'ok'));

    const goodEvents: MeshEvent[] = [];
    mesh.onEvent(() => {
      throw new Error('subscriber blew up');
    });
    mesh.onEvent((e) => goodEvents.push(e));

    // dispatch must still complete despite the buggy subscriber.
    const result = await mesh.dispatch('go', sequentialPattern({ agentNames: ['only'] }));
    expect(result.finalOutput).toBe('ok');
    expect(goodEvents.length).toBeGreaterThan(0);

    await mesh.close();
  });

  it('agent events emitted OUTSIDE a dispatch do not surface (no MeshEvent leakage)', async () => {
    const mesh = meshFor('no-leak');
    const agent = makeAgent('lonely', 'hi');
    mesh.register(agent);

    const events: MeshEvent[] = [];
    mesh.onEvent((e) => events.push(e));

    // Direct run, no dispatch wrapper. Should produce zero MeshEvents
    // because there is no AsyncLocalStorage task context to attach to.
    await agent.run('go', { onChunk: () => undefined });
    expect(events).toEqual([]);

    await mesh.close();
  });
});
