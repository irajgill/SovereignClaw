/**
 * Phase B PR2 integration test for the MeshEvent surface.
 *
 * Real 2-agent sequential mesh on 0G testnet (Brain-stub → Strategist-stub),
 * each makes one real Router streaming inference call. Asserts the MeshEvent
 * sequence is well-formed end-to-end with real tokens flowing.
 *
 * Skips with a clear message when INTEGRATION != '1' or required env is
 * missing. Uses InMemory for the bus (we are not testing 0G Storage here;
 * the durable-bus path is covered in mesh-3-agent.test.ts).
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';
import { Mesh } from '../../src/mesh.js';
import type { MeshEvent } from '../../src/mesh-events.js';

const RUN = process.env.INTEGRATION === '1';
const HAVE_KEY = !!process.env.COMPUTE_ROUTER_API_KEY;
const skip = !RUN || !HAVE_KEY;

describe.skipIf(skip)('Mesh MeshEvent surface (integration, real Router)', () => {
  beforeAll(() => {
    if (!process.env.COMPUTE_ROUTER_API_KEY) {
      throw new Error('COMPUTE_ROUTER_API_KEY missing — cannot run mesh-events integration test');
    }
  });

  it('emits ≥5 thinking-token events per agent, fires agent.handoff between agents, terminates with task.complete', async () => {
    const inference = sealed0GInference({
      model: 'qwen/qwen-2.5-7b-instruct',
      apiKey: process.env.COMPUTE_ROUTER_API_KEY!,
      baseUrl: process.env.COMPUTE_ROUTER_BASE_URL,
      verifiable: true,
      timeoutMs: 60_000,
    });

    const brain = new Agent({
      role: 'brain',
      systemPrompt: 'You are a brief planning agent. Answer in 1–2 short sentences. No lists.',
      inference,
    });
    const strategist = new Agent({
      role: 'strategist',
      systemPrompt: 'You are a brief strategist. Answer in 1–2 short sentences. No lists.',
      inference,
    });

    const meshId = `mesh-events-int-${Date.now().toString(36)}`;
    const mesh = new Mesh({ meshId, provider: InMemory({ namespace: meshId }) });
    mesh.register(brain).register(strategist);

    const events: MeshEvent[] = [];
    mesh.onEvent((e) => events.push(e));

    // We deliberately bypass `sequentialPattern` here because it doesn't
    // pass `onChunk` — the streaming events only fire when the agent runs
    // in stream mode. The integration assertion is that streaming + mesh
    // event-translation work together end-to-end.
    const result = await mesh.dispatch('Explain TEEs in one short sentence.', async () => {
      const a = await mesh.get('brain')!.run('Why are TEEs useful for AI agents? One sentence.', {
        onChunk: () => undefined,
      });
      const b = await mesh
        .get('strategist')!
        .run(
          `Brain said: ${a?.text ?? ''}. In one sentence, what's a follow-up business question?`,
          { onChunk: () => undefined },
        );
      return { finalOutput: b?.text ?? '' };
    });

    await mesh.close();

    const types = events.map((e) => e.type);
    console.log(`[mesh-events.integration] events=${events.length} types=`, [...new Set(types)]);

    // Lifecycle bookends.
    expect(types[0]).toBe('task.created');
    expect(types[types.length - 1]).toBe('task.complete');

    // Two thinking-start / -end pairs (one per agent).
    expect(types.filter((t) => t === 'agent.thinking.start')).toHaveLength(2);
    expect(types.filter((t) => t === 'agent.thinking.end')).toHaveLength(2);

    // ≥5 token events per agent.
    const tokensByAgent = new Map<string, number>();
    for (const e of events) {
      if (e.type === 'agent.thinking.token') {
        tokensByAgent.set(e.agentRole, (tokensByAgent.get(e.agentRole) ?? 0) + 1);
      }
    }
    expect(tokensByAgent.get('brain') ?? 0, 'brain token chunk count').toBeGreaterThanOrEqual(5);
    expect(
      tokensByAgent.get('strategist') ?? 0,
      'strategist token chunk count',
    ).toBeGreaterThanOrEqual(5);

    // Exactly one handoff (brain → strategist).
    const handoffs = events.filter(
      (e): e is Extract<MeshEvent, { type: 'agent.handoff' }> => e.type === 'agent.handoff',
    );
    expect(handoffs).toHaveLength(1);
    const handoff = handoffs[0]!;
    expect(handoff.fromRole).toBe('brain');
    expect(handoff.toRole).toBe('strategist');

    // taskId is consistent.
    const taskIds = new Set(
      events.filter((e) => 'taskId' in e).map((e) => (e as { taskId: string }).taskId),
    );
    expect(taskIds.size).toBe(1);

    // Final output is the strategist's answer.
    const last = events[events.length - 1];
    if (!last || last.type !== 'task.complete') throw new Error('expected task.complete last');
    expect(last.finalOutput.length).toBeGreaterThan(10);
    expect(result.finalOutput.length).toBeGreaterThan(10);
  }, 180_000);
});
