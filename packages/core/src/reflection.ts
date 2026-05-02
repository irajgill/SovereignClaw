/**
 * Reflection wire types for @sovereignclaw/core.
 *
 * The `ReflectionConfig` interface lives here so `Agent` can consume it
 * structurally without importing `@sovereignclaw/reflection`. The actual
 * implementation — `reflectOnOutput(...)` — lives in that package, which
 * depends on core. This keeps the package graph acyclic and matches how
 * `MemoryProvider` is declared in `@sovereignclaw/memory` and consumed by core.
 */
import type { MemoryProvider } from '@sovereignclaw/memory';
import type { ChatMessage, InferenceAdapter, InferenceResult } from './inference.js';

export interface ReflectionContext {
  runId: string;
  input: string | ChatMessage[];
  messages: ChatMessage[];
  initialOutput: InferenceResult;
  inference: InferenceAdapter;
  history?: MemoryProvider;
}

export interface ReflectionRoundDetail {
  round: number;
  score: number;
  suggestion: string;
  reasoning: string;
  critiqueLatencyMs: number;
  revisionLatencyMs?: number;
}

export interface ReflectionLearning {
  key: string;
  pointer: string;
  timestamp: number;
}

export interface ReflectionResult {
  finalOutput: InferenceResult;
  rounds: number;
  accepted: boolean;
  score: number;
  reasoning: string;
  suggestion: string;
  roundDetails: ReflectionRoundDetail[];
  learning?: ReflectionLearning;
}

/** What `Agent` calls when `reflect` is configured. */
export interface ReflectionConfig {
  run(ctx: ReflectionContext): Promise<ReflectionResult>;
}
