/**
 * End-to-end tests for the Agent ↔ reflectOnOutput integration.
 *
 * These are still in-process (fake InferenceAdapter) but they exercise the
 * full Agent.run() code path: learnings loaded into context, reflect.*
 * events emitted, and learning records persisted in the history namespace
 * so a subsequent run picks them up.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  Agent,
  listRecentLearnings,
  LEARNING_PREFIX,
  type ChatMessage,
  type InferenceAdapter,
  type InferenceResult,
} from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';
import { reflectOnOutput } from '../src/reflect.js';

function fakeResult(text: string): InferenceResult {
  return {
    model: 'fake',
    text,
    attestation: { teeVerified: true, providerAddress: null, requestId: null },
    billing: { inputCost: 0n, outputCost: 0n, totalCost: 0n },
    latencyMs: 1,
    raw: {},
  };
}

/**
 * Single-adapter script that answers EITHER as the agent (non-critic) or as
 * the critic depending on whether the system prompt includes the
 * CRITIC_SYSTEM_PROMPT marker. This lets one adapter back both calls so
 * we don't need to plumb two adapters through the Agent.
 */
function dualAdapter(
  agentResponses: string[],
  criticResponses: string[],
): { adapter: InferenceAdapter; agentSeen: ChatMessage[][]; criticSeen: ChatMessage[][] } {
  let a = 0;
  let c = 0;
  const agentSeen: ChatMessage[][] = [];
  const criticSeen: ChatMessage[][] = [];
  const adapter: InferenceAdapter = {
    async run(messages): Promise<InferenceResult> {
      const isCritic = messages.some(
        (m) => m.role === 'system' && m.content.startsWith('You are a strict, concise critic'),
      );
      if (isCritic) {
        criticSeen.push(messages);
        if (c >= criticResponses.length) throw new Error(`critic exhausted at ${c}`);
        const text = criticResponses[c]!;
        c += 1;
        return fakeResult(text);
      }
      agentSeen.push(messages);
      if (a >= agentResponses.length) throw new Error(`agent exhausted at ${a}`);
      const text = agentResponses[a]!;
      a += 1;
      return fakeResult(text);
    },
  };
  return { adapter, agentSeen, criticSeen };
}

describe('Agent + reflectOnOutput', () => {
  it('emits reflect.start and reflect.complete around the sub-loop', async () => {
    const { adapter } = dualAdapter(
      ['first answer'],
      ['{"score": 0.9, "suggestion": "", "reasoning": "ok"}'],
    );
    const history = InMemory({ namespace: 'h' });
    const agent = new Agent({
      role: 'r',
      inference: adapter,
      history,
      reflect: reflectOnOutput({ rubric: 'accuracy', persistLearnings: true }),
    });

    const startFn = vi.fn();
    const completeFn = vi.fn();
    agent.on('reflect.start', startFn);
    agent.on('reflect.complete', completeFn);

    const out = await agent.run('Q?');
    expect(out?.text).toBe('first answer');
    expect(startFn).toHaveBeenCalledOnce();
    expect(completeFn).toHaveBeenCalledOnce();
    const payload = completeFn.mock.calls[0]![0] as {
      result: { accepted: boolean; score: number };
    };
    expect(payload.result.accepted).toBe(true);
    expect(payload.result.score).toBe(0.9);
  });

  it('writes a learning:<runId> record that listRecentLearnings can read', async () => {
    const history = InMemory({ namespace: 'h' });
    const { adapter } = dualAdapter(
      ['my answer'],
      ['{"score": 0.85, "suggestion": "tighter", "reasoning": "ok"}'],
    );
    const agent = new Agent({
      role: 'r',
      inference: adapter,
      history,
      reflect: reflectOnOutput({ persistLearnings: true }),
    });
    await agent.run('Q?');

    const learned = await listRecentLearnings(history, 10);
    expect(learned).toHaveLength(1);
    expect(learned[0]?.finalOutputText).toBe('my answer');
    expect(learned[0]?.accepted).toBe(true);
    expect(learned[0]?.score).toBeCloseTo(0.85, 2);

    // Key prefix is the shared constant.
    let keyCount = 0;
    for await (const entry of history.list(LEARNING_PREFIX)) {
      expect(entry.key.startsWith(LEARNING_PREFIX)).toBe(true);
      keyCount += 1;
    }
    expect(keyCount).toBe(1);
  });

  it('injects recent learnings into the next run context', async () => {
    const history = InMemory({ namespace: 'h' });

    // Round A: produce a learning.
    const a = dualAdapter(
      ['first answer about foo'],
      ['{"score": 0.9, "suggestion": "", "reasoning": "ok"}'],
    );
    const agentA = new Agent({
      role: 'r',
      inference: a.adapter,
      history,
      reflect: reflectOnOutput({ persistLearnings: true }),
    });
    await agentA.run('Tell me about foo');
    expect((await listRecentLearnings(history, 10))).toHaveLength(1);

    // Round B: same history, different adapter — assert the agent call
    // includes a system message mentioning the prior learning.
    const b = dualAdapter(
      ['second answer'],
      ['{"score": 0.95, "suggestion": "", "reasoning": ""}'],
    );
    const agentB = new Agent({
      role: 'r',
      inference: b.adapter,
      history,
      reflect: reflectOnOutput({ persistLearnings: true }),
    });
    await agentB.run('Tell me about foo again');

    const agentMessagesOnRound2 = b.agentSeen[0]!;
    const learningsSystem = agentMessagesOnRound2.find(
      (m) => m.role === 'system' && m.content.startsWith('Prior reflected learnings'),
    );
    expect(learningsSystem).toBeDefined();
    expect(learningsSystem!.content).toContain('first answer about foo');
    expect(learningsSystem!.content).toContain('score 0.90');
  });

  it('does not inject learnings when reflect is not configured', async () => {
    const history = InMemory({ namespace: 'h' });
    await history.set(
      'learning:preseed',
      new TextEncoder().encode(
        JSON.stringify({
          version: 1,
          runId: 'preseed',
          inputText: 'x',
          initialOutputText: 'x',
          finalOutputText: 'x',
          score: 0.9,
          reasoning: '',
          suggestion: '',
          rounds: 1,
          accepted: true,
          timestamp: Date.now(),
        }),
      ),
    );

    const { adapter, agentSeen } = dualAdapter(['answer'], []);
    const agent = new Agent({ role: 'r', inference: adapter, history });
    await agent.run('Q?');
    const injected = agentSeen[0]!.find(
      (m) => m.role === 'system' && m.content.startsWith('Prior reflected learnings'),
    );
    expect(injected).toBeUndefined();
  });

  it('respects learningsContextLimit', async () => {
    const history = InMemory({ namespace: 'h' });
    for (let i = 0; i < 5; i += 1) {
      await history.set(
        `learning:r${i}`,
        new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            runId: `r${i}`,
            inputText: `i${i}`,
            initialOutputText: 'a',
            finalOutputText: `answer-${i}`,
            score: 0.9,
            reasoning: '',
            suggestion: '',
            rounds: 1,
            accepted: true,
            timestamp: Date.now() + i,
          }),
        ),
      );
    }

    const { adapter, agentSeen } = dualAdapter(
      ['new answer'],
      ['{"score": 0.95, "suggestion": "", "reasoning": ""}'],
    );
    const agent = new Agent({
      role: 'r',
      inference: adapter,
      history,
      reflect: reflectOnOutput({ persistLearnings: false }),
      learningsContextLimit: 2,
    });
    await agent.run('Q');
    const learnings = agentSeen[0]!.find((m) =>
      m.content.startsWith('Prior reflected learnings'),
    )!;
    // 2 learnings means two numbered bullets
    expect(learnings.content.match(/^\s{2}\d\./gm)?.length).toBe(2);
  });
});
