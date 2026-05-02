/**
 * Bus and Mesh wire types for @sovereignclaw/mesh.
 *
 * Every bus event is an append-only JSON envelope stored on a MemoryProvider
 * (typically `encrypted(OG_Log(...))`). Keys are zero-padded seqs so
 * lexicographic order matches numerical order for prefix-scan replay.
 */
import type { Pointer } from '@sovereignclaw/memory';

/**
 * The canonical bus event. Writers fill seq and timestamp at append time;
 * callers only supply payload + type + routing.
 */
export interface BusEvent<P = unknown> {
  /** Stable mesh identifier. One namespace per mesh instance. */
  meshId: string;
  /** Monotonic within a meshId. Single-writer guarantees strict order; §8.1 multi-writer tiebreak is Phase 5.1. */
  seq: number;
  /** Well-known or user-defined event type. */
  type: BusEventType | string;
  /** Role or address of the agent (or 'mesh' for orchestrator events). */
  fromAgent: string;
  /** Optional direct target; undefined means broadcast. */
  toAgent?: string;
  /** Structured payload; shape is per-type. */
  payload: P;
  /** Unix ms at write time. */
  timestamp: number;
  /** Chain this event to a parent by seq, e.g. executor replies tag the plan. */
  parentSeq?: number;
}

/**
 * The well-known event types emitted by @sovereignclaw/mesh patterns. User
 * code can pass arbitrary strings too; this enum is for autocomplete and
 * for pattern implementations.
 */
export const BusEventTypes = {
  TaskCreated: 'task.created',
  PlanCreated: 'plan.created',
  ExecutionStarted: 'execution.started',
  ExecutionComplete: 'execution.complete',
  CritiqueCreated: 'critique.created',
  PlanRevise: 'plan.revise',
  TaskComplete: 'task.complete',
  TaskAborted: 'task.aborted',
} as const;

export type BusEventType = (typeof BusEventTypes)[keyof typeof BusEventTypes];

/** Payload of a task.created event. */
export interface TaskCreatedPayload {
  task: string;
  round: number;
}

/** Payload of a plan.created event. */
export interface PlanCreatedPayload {
  task: string;
  plan: string;
  round: number;
}

/** Payload of an execution.started event. */
export interface ExecutionStartedPayload {
  plan: string;
  executor: string;
  round: number;
}

/** Payload of an execution.complete event. */
export interface ExecutionCompletePayload {
  executor: string;
  output: string;
  round: number;
  latencyMs?: number;
  teeVerified?: boolean | null;
}

/** Payload of a critique.created event. */
export interface CritiqueCreatedPayload {
  score: number;
  suggestion: string;
  reasoning: string;
  round: number;
  acceptedExecutor?: string;
  acceptedOutput?: string;
}

/** Payload of a task.complete event. */
export interface TaskCompletePayload {
  task: string;
  finalOutput: string;
  rounds: number;
  score: number;
  acceptedExecutor: string;
}

/** Result of appending a single event to the bus. */
export interface BusAppendResult<P = unknown> {
  event: BusEvent<P>;
  pointer: Pointer;
  key: string;
}

/** What `planExecuteCritique` returns to the caller. */
export interface PlanExecuteCritiqueResult {
  finalOutput: string;
  rounds: number;
  score: number;
  acceptedExecutor: string;
  eventPointers: Pointer[];
  eventKeys: string[];
}
