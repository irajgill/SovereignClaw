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
const CONTEXT_KEY = 'context';
const HISTORY_PREFIX = 'run:';

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
    options?: { maxTokens?: number; temperature?: number },
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

      if (typeof input === 'string') {
        messages.push({ role: 'user', content: input });
      } else {
        messages.push(...input);
      }

      if (this.cfg.beforeRun) {
        await this.cfg.beforeRun({ runId, input, messages });
      }

      const output = await this.cfg.inference.run(messages, {
        maxTokens: options?.maxTokens ?? this.cfg.maxTokens,
        temperature: options?.temperature ?? this.cfg.temperature,
      });

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
