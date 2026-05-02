/**
 * Typed event emitter for Agent lifecycle.
 *
 * Wraps Node's EventEmitter with TypeScript-friendly types so callers get
 * autocomplete on event names and payloads.
 */
import { EventEmitter } from 'node:events';
import type { ChatMessage, InferenceResult } from './inference.js';

export interface AgentEvents {
  'run.start': { input: string | ChatMessage[]; runId: string };
  'run.complete': { input: string | ChatMessage[]; output: InferenceResult; runId: string };
  'run.error': { error: unknown; runId: string };
  'tool.call': { tool: string; args: unknown; runId: string };
  'tool.result': { tool: string; args: unknown; result: unknown; runId: string };
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
