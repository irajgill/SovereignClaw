/**
 * reflectOnOutput — the public entry point for @sovereignclaw/reflection.
 *
 * Returns a `ReflectionConfig` that `Agent` can plug in via
 * `new Agent({ ..., reflect: reflectOnOutput({ rubric: 'accuracy' }) })`.
 *
 * Loop (§10.2):
 *   1. Start from `initialOutput` (produced by `Agent` before it handed
 *      control to us).
 *   2. Build critique prompt from the rubric; call critic adapter.
 *   3. Parse {score, suggestion, reasoning}.
 *   4. If score ≥ threshold, accept.
 *   5. Otherwise build a revision prompt, call the *agent's* inference
 *      adapter again to produce a new candidate, and loop up to `rounds`
 *      times.
 *   6. Persist the final record to history as a 'learning:<runId>' entry
 *      when `persistLearnings` is true.
 *
 * Design note: we call `ctx.inference.run(...)` for revisions instead of
 * `agent.run(...)` to keep the loop inside a single run and avoid
 * recursive `reflect` triggers.
 */
import type {
  ChatMessage,
  InferenceAdapter,
  InferenceResult,
  ReflectionConfig,
  ReflectionContext,
  ReflectionResult,
  ReflectionRoundDetail,
} from '@sovereignclaw/core';
import { parseCritique } from './parser.js';
import {
  buildBuiltInRubricPrompt,
  buildCustomRubricPrompt,
  CRITIC_SYSTEM_PROMPT,
  type BuiltInRubric,
  type CustomRubric,
} from './rubrics.js';
import { persistLearning } from './learning.js';
import { InvalidReflectionConfigError } from './errors.js';

export interface ReflectOnOutputOptions {
  /** Max number of critique+revise rounds. Default 1. */
  rounds?: number;
  /**
   * 'self' = reuse the agent's own inference adapter as the critic.
   * InferenceAdapter = a (typically stronger) model to act as a peer critic.
   * Default 'self'.
   */
  critic?: 'self' | InferenceAdapter;
  /** Built-in rubric name or custom rubric callback. Default 'accuracy'. */
  rubric?: BuiltInRubric | CustomRubric;
  /** Write a `learning:<runId>` record to history when done. Default true. */
  persistLearnings?: boolean;
  /** Accept threshold in [0,1]. Default 0.7. */
  threshold?: number;
  /** Optional max tokens for the critic call. */
  maxCritiqueTokens?: number;
}

const DEFAULT_ROUNDS = 1;
const DEFAULT_THRESHOLD = 0.7;
const DEFAULT_MAX_CRITIQUE_TOKENS = 320;

function stringifyInput(input: string | ChatMessage[]): string {
  if (typeof input === 'string') return input;
  return input.map((m) => `${m.role}: ${m.content}`).join('\n');
}

function buildRubricPrompt(
  rubric: BuiltInRubric | CustomRubric,
  input: string,
  output: string,
): string {
  if (typeof rubric === 'string') return buildBuiltInRubricPrompt(rubric, input, output);
  return buildCustomRubricPrompt(rubric, input, output);
}

function buildRevisionMessages(
  baseMessages: ChatMessage[],
  previousOutput: string,
  suggestion: string,
  reasoning: string,
): ChatMessage[] {
  const revisionInstruction: ChatMessage = {
    role: 'system',
    content: [
      'A critic scored your previous answer below the acceptance threshold.',
      `Critic reasoning: ${reasoning || '(none provided)'}`,
      `Critic suggestion: ${suggestion || '(none provided)'}`,
      '',
      `Your previous answer was:\n${previousOutput}`,
      '',
      'Produce an improved answer that addresses the suggestion. Do not apologize. Do not mention the critic. Return only the improved answer.',
    ].join('\n'),
  };
  return [...baseMessages, revisionInstruction];
}

export function reflectOnOutput(options: ReflectOnOutputOptions = {}): ReflectionConfig {
  const rounds = options.rounds ?? DEFAULT_ROUNDS;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const persistLearnings = options.persistLearnings ?? true;
  const rubric: BuiltInRubric | CustomRubric = options.rubric ?? 'accuracy';
  const criticOpt: 'self' | InferenceAdapter = options.critic ?? 'self';
  const maxCritiqueTokens = options.maxCritiqueTokens ?? DEFAULT_MAX_CRITIQUE_TOKENS;

  if (!Number.isInteger(rounds) || rounds < 1) {
    throw new InvalidReflectionConfigError(`rounds must be a positive integer, got ${rounds}`);
  }
  if (threshold < 0 || threshold > 1) {
    throw new InvalidReflectionConfigError(`threshold must be in [0,1], got ${threshold}`);
  }

  return {
    async run(ctx: ReflectionContext): Promise<ReflectionResult> {
      const critic = criticOpt === 'self' ? ctx.inference : criticOpt;
      const inputText = stringifyInput(ctx.input);
      const baseMessages = ctx.messages;

      let currentOutput: InferenceResult = ctx.initialOutput;
      const roundDetails: ReflectionRoundDetail[] = [];
      let lastScore = 0;
      let lastReasoning = '';
      let lastSuggestion = '';

      for (let round = 1; round <= rounds; round += 1) {
        const critiquePrompt = buildRubricPrompt(rubric, inputText, currentOutput.text);
        const critiqueMessages: ChatMessage[] = [
          { role: 'system', content: CRITIC_SYSTEM_PROMPT },
          { role: 'user', content: critiquePrompt },
        ];
        const critiqueStart = Date.now();
        const critiqueResult = await critic.run(critiqueMessages, {
          maxTokens: maxCritiqueTokens,
          temperature: 0,
        });
        const critiqueLatencyMs = Date.now() - critiqueStart;
        const parsed = parseCritique(critiqueResult.text);
        lastScore = parsed.score;
        lastReasoning = parsed.reasoning;
        lastSuggestion = parsed.suggestion;

        const detail: ReflectionRoundDetail = {
          round,
          score: parsed.score,
          suggestion: parsed.suggestion,
          reasoning: parsed.reasoning,
          critiqueLatencyMs,
        };

        if (parsed.score >= threshold || round === rounds) {
          roundDetails.push(detail);
          break;
        }

        const revisionMessages = buildRevisionMessages(
          baseMessages,
          currentOutput.text,
          parsed.suggestion,
          parsed.reasoning,
        );
        const revisionStart = Date.now();
        const revisedOutput = await ctx.inference.run(revisionMessages, {
          maxTokens: undefined,
          temperature: undefined,
        });
        detail.revisionLatencyMs = Date.now() - revisionStart;
        roundDetails.push(detail);
        currentOutput = revisedOutput;
      }

      const accepted = lastScore >= threshold;
      const result: ReflectionResult = {
        finalOutput: currentOutput,
        rounds: roundDetails.length,
        accepted,
        score: lastScore,
        reasoning: lastReasoning,
        suggestion: lastSuggestion,
        roundDetails,
      };

      if (persistLearnings && ctx.history) {
        try {
          const saved = await persistLearning(ctx.history, {
            runId: ctx.runId,
            inputText,
            initialOutputText: ctx.initialOutput.text,
            finalOutputText: currentOutput.text,
            score: lastScore,
            reasoning: lastReasoning,
            suggestion: lastSuggestion,
            rounds: roundDetails.length,
            accepted,
            timestamp: Date.now(),
          });
          result.learning = {
            key: saved.key,
            pointer: saved.pointer,
            timestamp: Date.now(),
          };
        } catch {
          // Swallow persistence errors — never block a successful run on
          // learning persistence. The caller can also `listRecentLearnings`
          // to audit, and a failed write will simply not show up.
        }
      }

      return result;
    },
  };
}
