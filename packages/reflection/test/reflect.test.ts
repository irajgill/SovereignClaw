/**
 * reflectOnOutput unit tests driven by fake InferenceAdapters.
 *
 * The adapter's `run()` is scripted so we can exercise all branches of the
 * loop (accept-round-1, revise-and-accept-round-2, max-rounds-reached,
 * custom rubric, peer critic, persistLearnings off/on) without a network.
 */
import { describe, expect, it } from 'vitest';
import {
  listRecentLearnings,
  type ChatMessage,
  type InferenceAdapter,
  type InferenceResult,
  type ReflectionContext,
} from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';
import { reflectOnOutput } from '../src/reflect.js';
import { InvalidReflectionConfigError } from '../src/errors.js';
import { CRITIC_OUTPUT_SHAPE } from '../src/rubrics.js';

function fakeResult(text: string, latencyMs = 1): InferenceResult {
  return {
    model: 'fake',
    text,
    attestation: { teeVerified: true, providerAddress: null, requestId: null },
    billing: { inputCost: 0n, outputCost: 0n, totalCost: 0n },
    latencyMs,
    raw: {},
  };
}

type Callback = (messages: ChatMessage[]) => string | Promise<string>;

function scripted(callbacks: Callback[]): InferenceAdapter {
  let i = 0;
  return {
    async run(messages): Promise<InferenceResult> {
      const cb = callbacks[i];
      if (!cb) {
        throw new Error(
          `fake adapter exhausted at call ${i + 1}; only ${callbacks.length} scripted`,
        );
      }
      i += 1;
      const text = await cb(messages);
      return fakeResult(text);
    },
  };
}

// Touch the helper so lint does not flag the exported name when a test
// only uses inline adapters. Vitest's tree-shaker is fine either way.
void scripted;

function baseContext(
  overrides: Partial<ReflectionContext> & { inference: InferenceAdapter },
): ReflectionContext {
  return {
    runId: 'run-1',
    input: 'What year was the Transformer paper published?',
    messages: [
      { role: 'system', content: 'You are a researcher.' },
      { role: 'user', content: 'What year was the Transformer paper published?' },
    ],
    initialOutput: fakeResult('2016.'),
    ...overrides,
  };
}

describe('reflectOnOutput', () => {
  it('accepts the initial output when the critic scores above threshold (round 1)', async () => {
    const critic = scripted([() => '{"score": 0.9, "suggestion": "", "reasoning": "correct"}']);
    const cfg = reflectOnOutput({ rounds: 1, threshold: 0.7, critic, persistLearnings: false });
    const ctx = baseContext({ inference: critic, initialOutput: fakeResult('2017.') });

    const r = await cfg.run(ctx);
    expect(r.accepted).toBe(true);
    expect(r.rounds).toBe(1);
    expect(r.finalOutput.text).toBe('2017.');
    expect(r.score).toBe(0.9);
    expect(r.roundDetails).toHaveLength(1);
    expect(r.roundDetails[0]?.revisionLatencyMs).toBeUndefined();
  });

  it('revises and accepts on round 2 when round 1 is below threshold', async () => {
    const criticResponses: Callback[] = [
      () => '{"score": 0.3, "suggestion": "use correct year", "reasoning": "wrong"}',
      () => '{"score": 0.95, "suggestion": "", "reasoning": "correct"}',
    ];
    const inferenceResponses: Callback[] = [() => '2017.'];

    let criticIdx = 0;
    let inferIdx = 0;
    const critic: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        if (criticIdx >= criticResponses.length) throw new Error('critic exhausted');
        const t = await criticResponses[criticIdx]!([]);
        criticIdx += 1;
        return fakeResult(t);
      },
    };
    const inference: InferenceAdapter = {
      async run(messages): Promise<InferenceResult> {
        if (inferIdx >= inferenceResponses.length) throw new Error('inference exhausted');
        const t = await inferenceResponses[inferIdx]!(messages);
        inferIdx += 1;
        return fakeResult(t);
      },
    };

    const cfg = reflectOnOutput({ rounds: 2, threshold: 0.7, critic, persistLearnings: false });
    const ctx = baseContext({ inference, initialOutput: fakeResult('2016.') });
    const r = await cfg.run(ctx);

    expect(r.accepted).toBe(true);
    expect(r.rounds).toBe(2);
    expect(r.finalOutput.text).toBe('2017.');
    expect(r.score).toBeCloseTo(0.95, 2);
    expect(r.roundDetails).toHaveLength(2);
    expect(r.roundDetails[0]?.revisionLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it('returns unaccepted result when max rounds reached without threshold', async () => {
    const critic: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        return fakeResult('{"score": 0.2, "suggestion": "try harder", "reasoning": "off"}');
      },
    };
    const inference: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        return fakeResult('still wrong');
      },
    };
    const cfg = reflectOnOutput({ rounds: 2, threshold: 0.7, critic, persistLearnings: false });
    const ctx = baseContext({ inference, initialOutput: fakeResult('wrong') });
    const r = await cfg.run(ctx);
    expect(r.accepted).toBe(false);
    expect(r.rounds).toBe(2);
    expect(r.score).toBeCloseTo(0.2, 2);
    expect(r.finalOutput.text).toBe('still wrong');
  });

  it('uses ctx.inference as critic when critic is "self"', async () => {
    const seen: ChatMessage[][] = [];
    const inference: InferenceAdapter = {
      async run(messages): Promise<InferenceResult> {
        seen.push(messages);
        return fakeResult('{"score": 1.0, "suggestion": "", "reasoning": ""}');
      },
    };
    const cfg = reflectOnOutput({ rounds: 1, critic: 'self', persistLearnings: false });
    const ctx = baseContext({ inference, initialOutput: fakeResult('answer') });
    const r = await cfg.run(ctx);
    expect(r.accepted).toBe(true);
    expect(seen).toHaveLength(1);
    const criticMessages = seen[0]!;
    expect(criticMessages[0]?.role).toBe('system');
    expect(criticMessages[1]?.content).toContain('answer');
  });

  it('supports a peer critic (different adapter than ctx.inference)', async () => {
    const criticCalls: ChatMessage[][] = [];
    const inferenceCalls: ChatMessage[][] = [];
    const critic: InferenceAdapter = {
      async run(messages): Promise<InferenceResult> {
        criticCalls.push(messages);
        return fakeResult('{"score": 0.9, "suggestion": "", "reasoning": ""}');
      },
    };
    const inference: InferenceAdapter = {
      async run(messages): Promise<InferenceResult> {
        inferenceCalls.push(messages);
        return fakeResult('x');
      },
    };
    const cfg = reflectOnOutput({ rounds: 1, critic, persistLearnings: false });
    const ctx = baseContext({ inference, initialOutput: fakeResult('answer') });
    await cfg.run(ctx);
    expect(criticCalls).toHaveLength(1);
    // Round 1 accepted — no revision call to the agent inference
    expect(inferenceCalls).toHaveLength(0);
  });

  it('applies a custom rubric via callback', async () => {
    const seen: ChatMessage[][] = [];
    const critic: InferenceAdapter = {
      async run(messages): Promise<InferenceResult> {
        seen.push(messages);
        return fakeResult('{"score": 0.9, "suggestion": "", "reasoning": ""}');
      },
    };
    const customRubric = (output: string, input: string): string =>
      `Custom: judge answer '${output}' to question '${input}' by my lights.`;
    const cfg = reflectOnOutput({ critic, rubric: customRubric, persistLearnings: false });
    const ctx = baseContext({ inference: critic, initialOutput: fakeResult('candidate') });
    await cfg.run(ctx);
    const user = seen[0]![1]!.content;
    expect(user).toContain('Custom: judge answer');
    expect(user).toContain('candidate');
    expect(user).toContain(CRITIC_OUTPUT_SHAPE);
  });

  it('persists a learning record to history when enabled and accepted', async () => {
    const history = InMemory({ namespace: 'history' });
    const critic: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        return fakeResult('{"score": 0.85, "suggestion": "more detail", "reasoning": "ok"}');
      },
    };
    const cfg = reflectOnOutput({ critic, persistLearnings: true });
    const ctx = baseContext({
      inference: critic,
      history,
      initialOutput: fakeResult('answer'),
    });
    const r = await cfg.run(ctx);
    expect(r.accepted).toBe(true);
    expect(r.learning).toBeDefined();
    expect(r.learning!.key).toBe('learning:run-1');

    const records = await listRecentLearnings(history, 10);
    expect(records).toHaveLength(1);
    expect(records[0]?.runId).toBe('run-1');
    expect(records[0]?.finalOutputText).toBe('answer');
    expect(records[0]?.score).toBeCloseTo(0.85, 2);
    expect(records[0]?.accepted).toBe(true);
    expect(records[0]?.version).toBe(1);
  });

  it('persists a learning record even when rejected (max rounds without accept)', async () => {
    const history = InMemory({ namespace: 'h' });
    const critic: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        return fakeResult('{"score": 0.1, "suggestion": "s", "reasoning": "r"}');
      },
    };
    const inference: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        return fakeResult('still bad');
      },
    };
    const cfg = reflectOnOutput({ rounds: 2, threshold: 0.9, critic, persistLearnings: true });
    const ctx = baseContext({
      inference,
      history,
      initialOutput: fakeResult('bad'),
      runId: 'run-2',
    });
    const r = await cfg.run(ctx);
    expect(r.accepted).toBe(false);
    const records = await listRecentLearnings(history, 10);
    expect(records).toHaveLength(1);
    expect(records[0]?.runId).toBe('run-2');
    expect(records[0]?.accepted).toBe(false);
  });

  it('skips persistence when persistLearnings is false', async () => {
    const history = InMemory({ namespace: 'h' });
    const critic: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        return fakeResult('{"score": 0.9, "suggestion": "", "reasoning": ""}');
      },
    };
    const cfg = reflectOnOutput({ critic, persistLearnings: false });
    const ctx = baseContext({ inference: critic, history });
    const r = await cfg.run(ctx);
    expect(r.learning).toBeUndefined();
    const records = await listRecentLearnings(history);
    expect(records).toHaveLength(0);
  });

  it('does not fail the run when history.set throws', async () => {
    const history = InMemory({ namespace: 'h' });
    await history.close();
    const critic: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        return fakeResult('{"score": 0.9, "suggestion": "", "reasoning": ""}');
      },
    };
    const cfg = reflectOnOutput({ critic, persistLearnings: true });
    const ctx = baseContext({ inference: critic, history });
    const r = await cfg.run(ctx);
    expect(r.accepted).toBe(true);
    expect(r.learning).toBeUndefined();
  });

  it('rejects invalid configuration at construction time', () => {
    expect(() => reflectOnOutput({ rounds: 0 })).toThrow(InvalidReflectionConfigError);
    expect(() => reflectOnOutput({ rounds: 1.5 })).toThrow(InvalidReflectionConfigError);
    expect(() => reflectOnOutput({ threshold: -0.1 })).toThrow(InvalidReflectionConfigError);
    expect(() => reflectOnOutput({ threshold: 1.1 })).toThrow(InvalidReflectionConfigError);
  });

  it('surfaces CritiqueParseError when critic output is un-parseable', async () => {
    const critic: InferenceAdapter = {
      async run(): Promise<InferenceResult> {
        return fakeResult('no json here at all, sorry');
      },
    };
    const cfg = reflectOnOutput({ critic, persistLearnings: false });
    const ctx = baseContext({ inference: critic });
    await expect(cfg.run(ctx)).rejects.toMatchObject({ name: 'CritiqueParseError' });
  });
});
