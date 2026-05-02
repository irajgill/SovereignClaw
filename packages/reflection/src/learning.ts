/**
 * Learning persistence for @sovereignclaw/reflection.
 *
 * Reflection writes one record per completed run (not per round) to the
 * caller's history provider under a `learning:<runId>` key. The record is
 * the raw post-reflection judgement plus enough context to retrain a
 * future prompt. v1 schema is intentionally small.
 *
 * Readers should use `@sovereignclaw/core`'s `listRecentLearnings(history,
 * limit)` helper so that core and reflection stay in lockstep on the
 * envelope shape.
 */
import { LEARNING_PREFIX } from '@sovereignclaw/core';
import type { MemoryProvider, Pointer } from '@sovereignclaw/memory';
import { LearningPersistError } from './errors.js';

export interface LearningRecordV1 {
  version: 1;
  runId: string;
  inputText: string;
  initialOutputText: string;
  finalOutputText: string;
  score: number;
  reasoning: string;
  suggestion: string;
  rounds: number;
  accepted: boolean;
  timestamp: number;
}

export function learningKey(runId: string): string {
  return `${LEARNING_PREFIX}${runId}`;
}

export async function persistLearning(
  history: MemoryProvider,
  record: Omit<LearningRecordV1, 'version'>,
): Promise<{ key: string; pointer: Pointer }> {
  const key = learningKey(record.runId);
  const body: LearningRecordV1 = { version: 1, ...record };
  const bytes = new TextEncoder().encode(JSON.stringify(body));
  try {
    const { pointer } = await history.set(key, bytes);
    return { key, pointer };
  } catch (err) {
    throw new LearningPersistError(err);
  }
}
