/**
 * planExecuteCritique unit tests using fake inference adapters.
 *
 * Fake adapters return scripted responses so we can deterministically
 * exercise the pattern's control flow without hitting any network.
 */
import { describe, expect, it } from 'vitest';
import { Agent, type ChatMessage, type InferenceAdapter, type InferenceResult } from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';
import { planExecuteCritique } from '../src/patterns/plan-execute-critique.js';
import { Mesh } from '../src/mesh.js';
import {
  BusEventTypes,
  type CritiqueCreatedPayload,
  type TaskCompletePayload,
} from '../src/types.js';
import {
  CritiqueParseError,
  EmptyAgentOutputError,
  MaxRoundsExceededError,
} from '../src/errors.js';

function scripted(responses: string[]): InferenceAdapter {
  let i = 0;
  return {
    async run(): Promise<InferenceResult> {
      const text = responses[i] ?? '';
      i += 1;
      return {
        model: 'fake',
        text,
        usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        attestation: { teeVerified: true, providerAddress: null, requestId: `fake-${i}` },
        billing: { inputCost: 0n, outputCost: 0n, totalCost: 0n },
        latencyMs: 1,
        raw: {},
      };
    },
  };
}

/** Like `scripted` but the response is a function of the call index. */
function scriptedFn(fn: (i: number, messages: ChatMessage[]) => string): InferenceAdapter {
  let i = 0;
  return {
    async run(messages): Promise<InferenceResult> {
      const text = fn(i, messages);
      i += 1;
      return {
        model: 'fake',
        text,
        attestation: { teeVerified: true, providerAddress: null, requestId: `fake-${i}` },
        billing: { inputCost: 0n, outputCost: 0n, totalCost: 0n },
        latencyMs: 1,
        raw: {},
      };
    },
  };
}

function makeMesh(meshId = 'unit-mesh'): Mesh {
  return new Mesh({ meshId, provider: InMemory({ namespace: meshId }) });
}

describe('planExecuteCritique', () => {
  it('accepts on round 1 when score is above threshold', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted(['1. research\n2. answer']) });
    const executor = new Agent({ role: 'executor', inference: scripted(['The capital of France is Paris.']) });
    const critic = new Agent({
      role: 'critic',
      inference: scripted(['{"score": 0.95, "suggestion": "none", "reasoning": "correct"}']),
    });

    const result = await planExecuteCritique({
      mesh,
      planner,
      executors: [executor],
      critic,
      task: 'What is the capital of France?',
      acceptThreshold: 0.7,
      maxRounds: 2,
    });

    expect(result.rounds).toBe(1);
    expect(result.score).toBeCloseTo(0.95, 2);
    expect(result.acceptedExecutor).toBe('executor');
    expect(result.finalOutput).toBe('The capital of France is Paris.');
    expect(result.eventPointers.length).toBeGreaterThanOrEqual(5);
    expect(result.eventKeys.length).toBe(result.eventPointers.length);

    const events = await mesh.bus.replay();
    expect(events[0]?.type).toBe(BusEventTypes.TaskCreated);
    expect(events[events.length - 1]?.type).toBe(BusEventTypes.TaskComplete);
    const complete = events[events.length - 1]?.payload as TaskCompletePayload;
    expect(complete.finalOutput).toBe('The capital of France is Paris.');
    await mesh.close();
  });

  it('loops when below threshold and accepts on round 2', async () => {
    const mesh = makeMesh();
    const planner = new Agent({
      role: 'planner',
      inference: scripted(['1. first attempt', '2. revised attempt']),
    });
    const executor = new Agent({
      role: 'executor',
      inference: scripted(['weak answer', 'strong answer']),
    });
    const critic = new Agent({
      role: 'critic',
      inference: scripted([
        '{"score": 0.3, "suggestion": "be more specific", "reasoning": "too vague"}',
        '{"score": 0.85, "suggestion": "none", "reasoning": "good"}',
      ]),
    });

    const result = await planExecuteCritique({
      mesh,
      planner,
      executors: [executor],
      critic,
      task: 'Summarise 0G',
      acceptThreshold: 0.7,
      maxRounds: 2,
    });

    expect(result.rounds).toBe(2);
    expect(result.finalOutput).toBe('strong answer');
    const events = await mesh.bus.replay();
    const reviseIdx = events.findIndex((e) => e.type === BusEventTypes.PlanRevise);
    expect(reviseIdx).toBeGreaterThan(0);
    // plan.revise only appears between rounds, so it must precede round-2 plan.created
    const planEvents = events.filter((e) => e.type === BusEventTypes.PlanCreated);
    expect(planEvents.length).toBe(2);
    await mesh.close();
  });

  it('picks the best executor across a parallel set', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted(['plan']) });
    const weak = new Agent({ role: 'weak', inference: scripted(['weak output']) });
    const strong = new Agent({ role: 'strong', inference: scripted(['strong output']) });
    const critic = new Agent({
      role: 'critic',
      inference: scriptedFn((_i, messages) => {
        const last = messages[messages.length - 1]?.content ?? '';
        if (last.includes('from weak')) {
          return '{"score": 0.2, "suggestion": "try again", "reasoning": "thin"}';
        }
        return '{"score": 0.9, "suggestion": "none", "reasoning": "solid"}';
      }),
    });

    const result = await planExecuteCritique({
      mesh,
      planner,
      executors: [weak, strong],
      critic,
      task: 'Pick one',
      acceptThreshold: 0.7,
      maxRounds: 1,
    });

    expect(result.acceptedExecutor).toBe('strong');
    expect(result.finalOutput).toBe('strong output');
    await mesh.close();
  });

  it('throws MaxRoundsExceededError when never crossing the threshold', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted(['p1', 'p2']) });
    const executor = new Agent({ role: 'executor', inference: scripted(['x1', 'x2']) });
    const critic = new Agent({
      role: 'critic',
      inference: scripted([
        '{"score": 0.1, "suggestion": "s", "reasoning": "r"}',
        '{"score": 0.2, "suggestion": "s", "reasoning": "r"}',
      ]),
    });

    await expect(
      planExecuteCritique({
        mesh,
        planner,
        executors: [executor],
        critic,
        task: 'Impossible',
        acceptThreshold: 0.7,
        maxRounds: 2,
      }),
    ).rejects.toBeInstanceOf(MaxRoundsExceededError);
    await mesh.close();
  });

  it('throws EmptyAgentOutputError if an agent returns nothing', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted([''])});
    const executor = new Agent({ role: 'executor', inference: scripted(['x']) });
    const critic = new Agent({
      role: 'critic',
      inference: scripted(['{"score": 0.9, "suggestion": "", "reasoning": ""}']),
    });

    await expect(
      planExecuteCritique({
        mesh,
        planner,
        executors: [executor],
        critic,
        task: 'T',
      }),
    ).rejects.toBeInstanceOf(EmptyAgentOutputError);
    await mesh.close();
  });

  it('clamps scores > 1 and < 0 into [0,1]', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted(['p']) });
    const executor = new Agent({ role: 'executor', inference: scripted(['x']) });
    const critic = new Agent({
      role: 'critic',
      inference: scripted(['{"score": 2.5, "suggestion": "", "reasoning": ""}']),
    });

    const result = await planExecuteCritique({
      mesh,
      planner,
      executors: [executor],
      critic,
      task: 'T',
      acceptThreshold: 0.7,
    });
    expect(result.score).toBe(1);
    await mesh.close();
  });

  it('tolerates fenced JSON from the critic', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted(['p']) });
    const executor = new Agent({ role: 'executor', inference: scripted(['x']) });
    const critic = new Agent({
      role: 'critic',
      inference: scripted([
        '```json\n{"score": 0.8, "suggestion": "", "reasoning": "ok"}\n```',
      ]),
    });

    const result = await planExecuteCritique({
      mesh,
      planner,
      executors: [executor],
      critic,
      task: 'T',
      acceptThreshold: 0.7,
    });
    expect(result.score).toBeCloseTo(0.8, 2);
    await mesh.close();
  });

  it('tolerates JSON inside surrounding prose', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted(['p']) });
    const executor = new Agent({ role: 'executor', inference: scripted(['x']) });
    const critic = new Agent({
      role: 'critic',
      inference: scripted([
        'Here is my critique: {"score": 0.9, "suggestion": "tight", "reasoning": "ok"} — hope it helps.',
      ]),
    });

    const result = await planExecuteCritique({
      mesh,
      planner,
      executors: [executor],
      critic,
      task: 'T',
      acceptThreshold: 0.7,
    });
    expect(result.score).toBeCloseTo(0.9, 2);
    await mesh.close();
  });

  it('throws CritiqueParseError on unparseable critic output', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted(['p']) });
    const executor = new Agent({ role: 'executor', inference: scripted(['x']) });
    const critic = new Agent({
      role: 'critic',
      inference: scripted(['just some prose with no JSON']),
    });

    await expect(
      planExecuteCritique({
        mesh,
        planner,
        executors: [executor],
        critic,
        task: 'T',
      }),
    ).rejects.toBeInstanceOf(CritiqueParseError);
    await mesh.close();
  });

  it('records parentSeq linkage between plan → exec.start → exec.complete → critique', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted(['p']) });
    const executor = new Agent({ role: 'executor', inference: scripted(['x']) });
    const critic = new Agent({
      role: 'critic',
      inference: scripted(['{"score": 0.9, "suggestion": "", "reasoning": ""}']),
    });

    await planExecuteCritique({
      mesh,
      planner,
      executors: [executor],
      critic,
      task: 'T',
      acceptThreshold: 0.7,
    });

    const events = await mesh.bus.replay();
    const byType = new Map(events.map((e) => [e.type, e]));
    const planE = byType.get(BusEventTypes.PlanCreated)!;
    const startE = byType.get(BusEventTypes.ExecutionStarted)!;
    const doneE = byType.get(BusEventTypes.ExecutionComplete)!;
    const critE = byType.get(BusEventTypes.CritiqueCreated)!;
    expect(startE.parentSeq).toBe(planE.seq);
    expect(doneE.parentSeq).toBe(startE.seq);
    expect(critE.parentSeq).toBe(doneE.seq);
    const critPayload = critE.payload as CritiqueCreatedPayload;
    expect(critPayload.acceptedExecutor).toBe('executor');
    await mesh.close();
  });

  it('rejects when executors is empty', async () => {
    const mesh = makeMesh();
    const planner = new Agent({ role: 'planner', inference: scripted([]) });
    const critic = new Agent({ role: 'critic', inference: scripted([]) });
    await expect(
      planExecuteCritique({
        mesh,
        planner,
        executors: [],
        critic,
        task: 'T',
      }),
    ).rejects.toBeInstanceOf(RangeError);
    await mesh.close();
  });
});
