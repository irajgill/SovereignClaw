/**
 * planExecuteCritique — the default multi-agent pattern.
 *
 * Three-role pipeline:
 *   planner  → proposes a plan for the task
 *   executors → run the plan (in parallel if >1)
 *   critic   → scores the best executor output against a rubric
 *
 * Accept if `score >= acceptThreshold`; otherwise emit `plan.revise` and
 * loop up to `maxRounds`. Every step writes a typed event to the mesh bus
 * so the whole flow is replayable from 0G later.
 *
 * The pattern is pure orchestration — zero SDK dependencies beyond the
 * agents it's handed. Reusable with any Agent instances the caller chooses
 * to wire up.
 */
import type { Agent } from '@sovereignclaw/core';
import type { Pointer } from '@sovereignclaw/memory';
import type { Mesh } from '../mesh.js';
import {
  BusEventTypes,
  type CritiqueCreatedPayload,
  type ExecutionCompletePayload,
  type ExecutionStartedPayload,
  type PlanCreatedPayload,
  type PlanExecuteCritiqueResult,
  type TaskCompletePayload,
  type TaskCreatedPayload,
} from '../types.js';
import { CritiqueParseError, EmptyAgentOutputError, MaxRoundsExceededError } from '../errors.js';

export interface PlanExecuteCritiqueOptions {
  mesh: Mesh;
  planner: Agent;
  executors: Agent[];
  critic: Agent;
  task: string;
  /** Upper bound on rounds before MaxRoundsExceededError. Default 2. */
  maxRounds?: number;
  /** Score in [0,1] required to accept an executor output. Default 0.7. */
  acceptThreshold?: number;
  /** Optional rubric injected into the critic's prompt. Default: 'accuracy'. */
  rubric?: string;
}

const DEFAULT_MAX_ROUNDS = 2;
const DEFAULT_ACCEPT_THRESHOLD = 0.7;
const DEFAULT_RUBRIC = 'accuracy';

const CRITIC_INSTRUCTION = `You are a strict critic. Score the candidate answer from 0.0 to 1.0 against the rubric. Reply with ONLY a single JSON object on one line: {"score": <0.0-1.0>, "suggestion": "<short actionable improvement>", "reasoning": "<1-2 sentence why>"}. No other text. No markdown. No code fences.`;

export async function planExecuteCritique(
  opts: PlanExecuteCritiqueOptions,
): Promise<PlanExecuteCritiqueResult> {
  if (opts.executors.length < 1) {
    throw new RangeError('planExecuteCritique: at least one executor required');
  }
  const maxRounds = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
  const acceptThreshold = opts.acceptThreshold ?? DEFAULT_ACCEPT_THRESHOLD;
  const rubric = opts.rubric ?? DEFAULT_RUBRIC;
  const { mesh, planner, executors, critic, task } = opts;

  const pointers: Pointer[] = [];
  const keys: string[] = [];
  const track = (pointer: Pointer, key: string): void => {
    pointers.push(pointer);
    keys.push(key);
  };

  // 0. task.created — roots the whole flow.
  const taskEvent = await mesh.bus.append<TaskCreatedPayload>({
    type: BusEventTypes.TaskCreated,
    fromAgent: 'mesh',
    payload: { task, round: 0 },
  });
  track(taskEvent.pointer, taskEvent.key);

  let best: {
    score: number;
    executor: string;
    output: string;
    plan: string;
    round: number;
  } | null = null;
  let currentPlan: string | null = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    // 1. planner emits a plan.
    const planInput =
      currentPlan === null
        ? `Task: ${task}\n\nProduce a concise, step-by-step plan to answer this task. Numbered list only.`
        : `Task: ${task}\n\nPrevious plan:\n${currentPlan}\n\nCritic feedback (score=${best?.score.toFixed(2) ?? 'n/a'}): ${best ? 'see prior critique' : ''}\n\nProduce a revised plan. Numbered list only.`;
    const planOut = await planner.run(planInput);
    if (!planOut || !planOut.text) {
      throw new EmptyAgentOutputError(planner.role, 'plan');
    }
    currentPlan = planOut.text.trim();
    const planEvent = await mesh.bus.append<PlanCreatedPayload>({
      type: BusEventTypes.PlanCreated,
      fromAgent: planner.role,
      parentSeq: taskEvent.event.seq,
      payload: { task, plan: currentPlan, round },
    });
    track(planEvent.pointer, planEvent.key);

    // 2. executors run in parallel, each gets the same plan.
    const executions = await Promise.all(
      executors.map(async (executor) => {
        const startEvt = await mesh.bus.append<ExecutionStartedPayload>({
          type: BusEventTypes.ExecutionStarted,
          fromAgent: executor.role,
          parentSeq: planEvent.event.seq,
          payload: { plan: currentPlan as string, executor: executor.role, round },
        });
        track(startEvt.pointer, startEvt.key);

        const runInput = `Plan:\n${currentPlan}\n\nTask:\n${task}\n\nExecute the plan and produce a complete answer.`;
        const out = await executor.run(runInput);
        if (!out || !out.text) {
          throw new EmptyAgentOutputError(executor.role, `execute[round=${round}]`);
        }
        const doneEvt = await mesh.bus.append<ExecutionCompletePayload>({
          type: BusEventTypes.ExecutionComplete,
          fromAgent: executor.role,
          parentSeq: startEvt.event.seq,
          payload: {
            executor: executor.role,
            output: out.text.trim(),
            round,
            latencyMs: out.latencyMs,
            teeVerified: out.attestation.teeVerified,
          },
        });
        track(doneEvt.pointer, doneEvt.key);
        return {
          executor: executor.role,
          output: out.text.trim(),
          round,
          doneSeq: doneEvt.event.seq,
        };
      }),
    );

    // 3. critic scores each executor output; pick the best.
    let bestThisRound: {
      score: number;
      executor: string;
      output: string;
      plan: string;
      round: number;
      critique?: { suggestion: string; reasoning: string };
      parentSeq: number;
    } | null = null;
    for (const exe of executions) {
      const critInput = `${CRITIC_INSTRUCTION}\n\nRubric: ${rubric}\n\nTask: ${task}\n\nCandidate answer from ${exe.executor}:\n${exe.output}`;
      const critOut = await critic.run(critInput);
      if (!critOut || !critOut.text) {
        throw new EmptyAgentOutputError(critic.role, `critique[round=${round}]`);
      }
      const parsed = parseCritique(critOut.text);
      const critEvt = await mesh.bus.append<CritiqueCreatedPayload>({
        type: BusEventTypes.CritiqueCreated,
        fromAgent: critic.role,
        parentSeq: exe.doneSeq,
        payload: {
          score: parsed.score,
          suggestion: parsed.suggestion,
          reasoning: parsed.reasoning,
          round,
          acceptedExecutor: exe.executor,
          acceptedOutput: exe.output,
        },
      });
      track(critEvt.pointer, critEvt.key);

      if (!bestThisRound || parsed.score > bestThisRound.score) {
        bestThisRound = {
          score: parsed.score,
          executor: exe.executor,
          output: exe.output,
          plan: currentPlan as string,
          round,
          critique: { suggestion: parsed.suggestion, reasoning: parsed.reasoning },
          parentSeq: critEvt.event.seq,
        };
      }
    }

    if (!bestThisRound) throw new EmptyAgentOutputError(critic.role, 'round');
    if (!best || bestThisRound.score > best.score) {
      best = {
        score: bestThisRound.score,
        executor: bestThisRound.executor,
        output: bestThisRound.output,
        plan: bestThisRound.plan,
        round: bestThisRound.round,
      };
    }

    if (bestThisRound.score >= acceptThreshold) {
      const completeEvt = await mesh.bus.append<TaskCompletePayload>({
        type: BusEventTypes.TaskComplete,
        fromAgent: 'mesh',
        parentSeq: bestThisRound.parentSeq,
        payload: {
          task,
          finalOutput: bestThisRound.output,
          rounds: round,
          score: bestThisRound.score,
          acceptedExecutor: bestThisRound.executor,
        },
      });
      track(completeEvt.pointer, completeEvt.key);
      return {
        finalOutput: bestThisRound.output,
        rounds: round,
        score: bestThisRound.score,
        acceptedExecutor: bestThisRound.executor,
        eventPointers: pointers,
        eventKeys: keys,
      };
    }

    // Below threshold — emit plan.revise and loop (unless this was the last round).
    if (round < maxRounds) {
      const reviseEvt = await mesh.bus.append({
        type: BusEventTypes.PlanRevise,
        fromAgent: 'mesh',
        parentSeq: bestThisRound.parentSeq,
        payload: {
          round,
          bestScore: bestThisRound.score,
          suggestion: bestThisRound.critique?.suggestion ?? '',
        },
      });
      track(reviseEvt.pointer, reviseEvt.key);
    }
  }

  throw new MaxRoundsExceededError(maxRounds, best?.score ?? 0);
}

interface ParsedCritique {
  score: number;
  suggestion: string;
  reasoning: string;
}

function parseCritique(raw: string): ParsedCritique {
  // Try strict JSON first; fall back to extracting the first {...} block
  // because weaker models often wrap their JSON in prose or a code fence.
  const tryParse = (candidate: string): ParsedCritique | null => {
    try {
      const obj = JSON.parse(candidate) as Record<string, unknown>;
      const score = typeof obj.score === 'number' ? obj.score : Number(obj.score);
      if (!Number.isFinite(score)) return null;
      const clamped = Math.max(0, Math.min(1, score));
      return {
        score: clamped,
        suggestion: typeof obj.suggestion === 'string' ? obj.suggestion : '',
        reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
      };
    } catch {
      return null;
    }
  };

  const direct = tryParse(raw.trim());
  if (direct) return direct;

  // Strip code fences if present.
  const fenced = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const fromFence = tryParse(fenced);
  if (fromFence) return fromFence;

  // Grab the first {...} block.
  const match = raw.match(/\{[\s\S]*?\}/);
  if (match) {
    const fromMatch = tryParse(match[0]);
    if (fromMatch) return fromMatch;
  }

  throw new CritiqueParseError(raw);
}
