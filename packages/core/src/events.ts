/**
 * Typed event emitter for Agent lifecycle.
 *
 * Wraps Node's EventEmitter with TypeScript-friendly types so callers get
 * autocomplete on event names and payloads.
 */
import { EventEmitter } from 'node:events';
import type { ChatMessage, InferenceResult } from './inference.js';
import type { ReflectionResult } from './reflection.js';

/**
 * Agent event surface. v0.2.0 adds the streaming-related events
 * (`agent.thinking.*`, `agent.action.*`, `agent.outcome`) so consumers like
 * `@sovereignclaw/mesh@0.2.0` can re-emit them on a unified mesh surface.
 *
 * Existing `run.*`, `tool.*`, and `reflect.*` payloads are unchanged.
 */
export interface AgentEvents {
  'run.start': { input: string | ChatMessage[]; runId: string };
  'run.complete': { input: string | ChatMessage[]; output: InferenceResult; runId: string };
  'run.error': { error: unknown; runId: string };
  'tool.call': { tool: string; args: unknown; runId: string };
  'tool.result': { tool: string; args: unknown; result: unknown; runId: string };
  'reflect.start': { input: string | ChatMessage[]; initialOutput: InferenceResult; runId: string };
  'reflect.complete': {
    input: string | ChatMessage[];
    result: ReflectionResult;
    runId: string;
  };
  /** Emitted once per streaming run, before the first `agent.thinking.token`. */
  'agent.thinking.start': { role: string; runId: string };
  /** Emitted for every non-empty token chunk during a streaming run. */
  'agent.thinking.token': { role: string; runId: string; text: string };
  /** Emitted once per streaming run, after the last token has been received. */
  'agent.thinking.end': { role: string; runId: string; fullText: string };
  /** Emitted before a tool runs. Tool symmetry partner of `agent.action.end`. */
  'agent.action.start': { role: string; runId: string; tool: string; args: unknown };
  /** Emitted after a tool runs (success). `ms` is wall-clock duration. */
  'agent.action.end': {
    role: string;
    runId: string;
    tool: string;
    result: unknown;
    ms: number;
  };
  /** Emitted at the end of a successful run with the final InferenceResult. */
  'agent.outcome': { role: string; runId: string; result: InferenceResult };
}

export type AgentEventName = keyof AgentEvents;
export type AgentEventHandler<E extends AgentEventName> = (payload: AgentEvents[E]) => void;

export class TypedEventEmitter {
  private readonly emitter = new EventEmitter();

  on<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): this {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
    return this;
  }

  off<E extends AgentEventName>(event: E, handler: AgentEventHandler<E>): this {
    this.emitter.off(event, handler as (...args: unknown[]) => void);
    return this;
  }

  emit<E extends AgentEventName>(event: E, payload: AgentEvents[E]): boolean {
    return this.emitter.emit(event, payload);
  }
}
