/**
 * Critique-response parser for @sovereignclaw/reflection.
 *
 * Open models routinely wrap JSON in prose or code fences even when the
 * prompt forbids it. We try three grammars in order: strict JSON, fence-
 * stripped JSON, and first `{...}` block. If all three fail, we throw
 * `CritiqueParseError` so the caller can surface a human-meaningful error
 * instead of silently scoring 0.
 */
import { CritiqueParseError } from './errors.js';

export interface ParsedCritique {
  score: number;
  suggestion: string;
  reasoning: string;
}

function coerce(candidate: string): ParsedCritique | null {
  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>;
    const scoreRaw = typeof obj.score === 'number' ? obj.score : Number(obj.score);
    if (!Number.isFinite(scoreRaw)) return null;
    const score = Math.max(0, Math.min(1, scoreRaw));
    return {
      score,
      suggestion: typeof obj.suggestion === 'string' ? obj.suggestion : '',
      reasoning: typeof obj.reasoning === 'string' ? obj.reasoning : '',
    };
  } catch {
    return null;
  }
}

export function parseCritique(raw: string): ParsedCritique {
  const direct = coerce(raw.trim());
  if (direct) return direct;

  const fenced = raw
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
  const fromFence = coerce(fenced);
  if (fromFence) return fromFence;

  const match = raw.match(/\{[\s\S]*?\}/);
  if (match) {
    const fromMatch = coerce(match[0]);
    if (fromMatch) return fromMatch;
  }

  throw new CritiqueParseError(raw);
}
