/**
 * Agent - public-facing orchestration class.
 *
 * Composes inference, memory, history, tools, lifecycle hooks, and typed events
 * into a single runnable unit.
 */
import { randomUUID } from 'node:crypto';
import type { MemoryProvider } from '@sovereignclaw/memory';
import { CoreError } from './errors.js';
import { TypedEventEmitter, type AgentEventHandler, type AgentEventName } from './events.js';
import type { ChatMessage, InferenceAdapter, InferenceResult } from './inference.js';
import type { InferenceChunk } from './sse-parser.js';
import type { ReflectionConfig, ReflectionLearning } from './reflection.js';
import type { Tool } from './tools.js';

export interface AgentConfig {
  role: string;
  inference: InferenceAdapter;
  memory?: MemoryProvider;
  history?: MemoryProvider;
  systemPrompt?: string;
  tools?: Tool[];
  maxTokens?: number;
  temperature?: number;
  historyContextLimit?: number;
  /**
   * Optional reflection config. If set, `Agent.run()` runs the reflection
   * sub-loop after inference (§7.2 step 7) and prepends recent learnings
   * to the message history before calling inference (§10.2 step 9).
   */
  reflect?: ReflectionConfig;
  /** Max recent learnings to prepend to context when reflect is configured. Default 3. */
  learningsContextLimit?: number;
  beforeRun?: (ctx: BeforeRunContext) => Promise<void> | void;
  afterRun?: (ctx: AfterRunContext) => Promise<void> | void;
  onError?: (ctx: OnErrorContext) => Promise<void> | void;
}

export interface BeforeRunContext {
  runId: string;
  input: string | ChatMessage[];
  messages: ChatMessage[];
}

export interface AfterRunContext {
  runId: string;
  input: string | ChatMessage[];
  output: InferenceResult;
}

export interface OnErrorContext {
  runId: string;
  input: string | ChatMessage[];
  error: unknown;
}

const DEFAULT_HISTORY_LIMIT = 10;
const DEFAULT_LEARNINGS_LIMIT = 3;
const CONTEXT_KEY = 'context';
const HISTORY_PREFIX = 'run:';
/** Shared prefix for learning entries written by @sovereignclaw/reflection. */
export const LEARNING_PREFIX = 'learning:';

interface PersistedContext {
  recentMessages: ChatMessage[];
  updatedAt: number;
}

interface HistoryEntry {
  runId: string;
  inputText: string;
  outputText: string;
  ts: number;
  model?: string;
  teeVerified?: boolean | null;
  totalCostWei?: string;
}

interface LearningRecord {
  version: number;
  runId: string;
  inputText: string;
  initialOutputText?: string;
  finalOutputText: string;
  score: number;
  reasoning?: string;
  suggestion?: string;
  rounds: number;
  accepted: boolean;
  timestamp: number;
}

function parseLearning(bytes: Uint8Array): LearningRecord | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as LearningRecord;
    if (!parsed || typeof parsed.runId !== 'string' || typeof parsed.finalOutputText !== 'string') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatLearningsAsSystemMessage(records: LearningRecord[]): string {
  const lines = records.map((r, i) => {
    const scored = Number.isFinite(r.score) ? r.score.toFixed(2) : 'n/a';
    const reason = r.reasoning?.trim();
    const reasonBlock = reason ? ` — reason: ${reason}` : '';
    return `  ${i + 1}. (score ${scored}, runId=${r.runId}) ${r.finalOutputText.slice(0, 400)}${reasonBlock}`;
  });
  return [
    'Prior reflected learnings (most recent first, provided as additional context):',
    ...lines,
    'Use these as precedent when they are relevant; otherwise ignore them.',
  ].join('\n');
}

/**
 * Helper: read up to `limit` most-recent learning records from a history
 * provider. Exported so callers that want to query learnings outside of a
 * run (e.g. dashboards, CLIs, `pnpm check:learnings`) can reuse the shape.
 */
export async function listRecentLearnings(
  history: MemoryProvider,
  limit = DEFAULT_LEARNINGS_LIMIT,
): Promise<LearningRecord[]> {
  const keys: string[] = [];
  for await (const entry of history.list(LEARNING_PREFIX)) {
    keys.push(entry.key);
  }
  const records: LearningRecord[] = [];
  for (const key of keys) {
    const bytes = await history.get(key);
    if (!bytes) continue;
    const parsed = parseLearning(bytes);
    if (parsed) records.push(parsed);
  }
  records.sort((a, b) => b.timestamp - a.timestamp);
  return records.slice(0, limit);
}

export class AgentClosedError extends CoreError {
  constructor(role: string) {
    super(`Agent (role='${role}') has been closed`);
  }
}

export class Agent {
  readonly role: string;
  private readonly cfg: AgentConfig;
  private readonly emitter = new TypedEventEmitter();
  private closed = false;

  constructor(config: AgentConfig) {
    this.role = config.role;
    this.cfg = config;
  }

  on<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): this {
    this.emitter.on(event, handler);
    return this;
  }

  off<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): this {
    this.emitter.off(event, handler);
    return this;
  }

  async run(
    input: string | ChatMessage[],
    options?: {
      maxTokens?: number;
      temperature?: number;
      /** v0.2.0 (Phase B PR1): when set, the inference adapter is called in
       *  streaming mode and each chunk is forwarded to this callback. The
       *  agent additionally emits `agent.thinking.{start,token,end}` events
       *  on its own emitter. The promise still resolves to the full
       *  InferenceResult after the stream completes. Reflection is
       *  incompatible with streaming mode (the reflection sub-loop wants a
       *  single concrete output to critique); when both are configured,
       *  streaming runs the initial inference but the reflection step uses
       *  the regular non-streaming adapter. */
      onChunk?: (chunk: InferenceChunk) => void;
      /** Optional AbortSignal forwarded to the inference adapter. */
      signal?: AbortSignal;
    },
  ): Promise<InferenceResult | null> {
    if (this.closed) throw new AgentClosedError(this.role);

    const runId = randomUUID();
    this.emitter.emit('run.start', { input, runId });

    try {
      const messages: ChatMessage[] = [];

      if (this.cfg.systemPrompt) {
        messages.push({ role: 'system', content: this.cfg.systemPrompt });
      }

      if (this.cfg.memory) {
        const ctxBytes = await this.cfg.memory.get(CONTEXT_KEY);
        if (ctxBytes) {
          try {
            const parsed = JSON.parse(new TextDecoder().decode(ctxBytes)) as PersistedContext;
            messages.push(...parsed.recentMessages);
          } catch {
            // Corrupt context should not crash a run. The next save overwrites it.
          }
        }
      }

      // §10.2 step 9: when reflect is configured, include recent learnings
      // in context so the agent can benefit from prior self-critique. v0
      // ranks by recency; top-k by embedding similarity is Phase 6.1.
      if (this.cfg.reflect && this.cfg.history) {
        const limit = this.cfg.learningsContextLimit ?? DEFAULT_LEARNINGS_LIMIT;
        try {
          const learnings = await listRecentLearnings(this.cfg.history, limit);
          if (learnings.length > 0) {
            messages.push({
              role: 'system',
              content: formatLearningsAsSystemMessage(learnings),
            });
          }
        } catch {
          // Never fail a run because learnings loading hiccuped. Next run gets another shot.
        }
      }

      if (typeof input === 'string') {
        messages.push({ role: 'user', content: input });
      } else {
        messages.push(...input);
      }

      if (this.cfg.beforeRun) {
        await this.cfg.beforeRun({ runId, input, messages });
      }

      const wantStream = options?.onChunk !== undefined;
      if (wantStream) {
        this.emitter.emit('agent.thinking.start', { role: this.role, runId });
      }

      // Wrap the user's onChunk so we can also emit agent.thinking.* events
      // and accumulate the full text on agent.thinking.end. Per spec, errors
      // thrown inside the user callback abort the stream — same as the
      // adapter's contract — so we don't try/catch here.
      let accumulatedText = '';
      const wrappedOnChunk = wantStream
        ? (chunk: InferenceChunk): void => {
            if (chunk.type === 'token') {
              accumulatedText += chunk.text;
              this.emitter.emit('agent.thinking.token', {
                role: this.role,
                runId,
                text: chunk.text,
              });
            }
            options!.onChunk!(chunk);
          }
        : undefined;

      // Build adapter options conditionally so the non-streaming call shape
      // is byte-identical to v0.1.x — existing strict-equality tests in
      // consumers continue to pass without churn.
      const adapterOpts: Parameters<InferenceAdapter['run']>[1] = {
        maxTokens: options?.maxTokens ?? this.cfg.maxTokens,
        temperature: options?.temperature ?? this.cfg.temperature,
      };
      if (wantStream) {
        adapterOpts.stream = true;
        adapterOpts.onChunk = wrappedOnChunk;
      }
      if (options?.signal) {
        adapterOpts.signal = options.signal;
      }

      const initialOutput = await this.cfg.inference.run(messages, adapterOpts);

      if (wantStream) {
        this.emitter.emit('agent.thinking.end', {
          role: this.role,
          runId,
          fullText: accumulatedText || initialOutput.text,
        });
      }

      let output = initialOutput;
      let persistedLearning: ReflectionLearning | undefined;
      if (this.cfg.reflect) {
        this.emitter.emit('reflect.start', { input, initialOutput, runId });
        const reflected = await this.cfg.reflect.run({
          runId,
          input,
          messages,
          initialOutput,
          inference: this.cfg.inference,
          history: this.cfg.history,
        });
        output = reflected.finalOutput;
        persistedLearning = reflected.learning;
        this.emitter.emit('reflect.complete', { input, result: reflected, runId });
      }
      void persistedLearning;

      if (this.cfg.afterRun) {
        await this.cfg.afterRun({ runId, input, output });
      }

      if (this.cfg.memory) {
        const limit = this.cfg.historyContextLimit ?? DEFAULT_HISTORY_LIMIT;
        const recent = messages.slice(-(limit - 1));
        recent.push({ role: 'assistant', content: output.text });
        const persisted: PersistedContext = {
          recentMessages: recent,
          updatedAt: Date.now(),
        };
        await this.cfg.memory.set(CONTEXT_KEY, new TextEncoder().encode(JSON.stringify(persisted)));
      }

      if (this.cfg.history) {
        const inputText =
          typeof input === 'string'
            ? input
            : input.map((message) => `${message.role}: ${message.content}`).join('\n');
        const entry: HistoryEntry = {
          runId,
          inputText,
          outputText: output.text,
          ts: Date.now(),
          model: output.model,
          teeVerified: output.attestation.teeVerified,
          totalCostWei: output.billing.totalCost.toString(),
        };
        await this.cfg.history.set(
          `${HISTORY_PREFIX}${runId}`,
          new TextEncoder().encode(JSON.stringify(entry)),
        );
      }

      this.emitter.emit('agent.outcome', { role: this.role, runId, result: output });
      this.emitter.emit('run.complete', { input, output, runId });
      return output;
    } catch (err) {
      this.emitter.emit('run.error', { error: err, runId });
      if (this.cfg.onError) {
        await this.cfg.onError({ runId, input, error: err });
        return null;
      }
      throw err;
    }
  }

  async flush(): Promise<void> {
    if (this.cfg.memory) await this.cfg.memory.flush();
    if (this.cfg.history) await this.cfg.history.flush();
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.cfg.memory) await this.cfg.memory.close();
    if (this.cfg.history) await this.cfg.history.close();
  }

  get tools(): readonly Tool[] {
    return this.cfg.tools ?? [];
  }
}
