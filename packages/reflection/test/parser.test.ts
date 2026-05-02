import { describe, expect, it } from 'vitest';
import { parseCritique } from '../src/parser.js';
import { CritiqueParseError } from '../src/errors.js';

describe('parseCritique', () => {
  it('parses strict single-line JSON', () => {
    const r = parseCritique('{"score": 0.8, "suggestion": "tighten it", "reasoning": "ok but long"}');
    expect(r.score).toBeCloseTo(0.8, 2);
    expect(r.suggestion).toBe('tighten it');
    expect(r.reasoning).toBe('ok but long');
  });

  it('tolerates pretty-printed JSON', () => {
    const raw = `{
      "score": 0.55,
      "suggestion": "add authors",
      "reasoning": "missing attribution"
    }`;
    const r = parseCritique(raw);
    expect(r.score).toBeCloseTo(0.55, 2);
    expect(r.suggestion).toBe('add authors');
  });

  it('strips ```json fences', () => {
    const r = parseCritique('```json\n{"score": 0.9, "suggestion": "", "reasoning": ""}\n```');
    expect(r.score).toBe(0.9);
  });

  it('strips plain ``` fences', () => {
    const r = parseCritique('```\n{"score": 0.4, "suggestion": "x", "reasoning": "y"}\n```');
    expect(r.score).toBe(0.4);
  });

  it('extracts JSON from surrounding prose', () => {
    const r = parseCritique(
      'Sure, here is my critique: {"score": 0.6, "suggestion": "s", "reasoning": "r"} — hope this helps.',
    );
    expect(r.score).toBe(0.6);
    expect(r.suggestion).toBe('s');
  });

  it('clamps score above 1', () => {
    const r = parseCritique('{"score": 2.5, "suggestion": "", "reasoning": ""}');
    expect(r.score).toBe(1);
  });

  it('clamps score below 0', () => {
    const r = parseCritique('{"score": -0.3, "suggestion": "", "reasoning": ""}');
    expect(r.score).toBe(0);
  });

  it('coerces numeric strings for score', () => {
    const r = parseCritique('{"score": "0.42", "suggestion": "", "reasoning": ""}');
    expect(r.score).toBeCloseTo(0.42, 2);
  });

  it('defaults missing suggestion/reasoning to empty strings', () => {
    const r = parseCritique('{"score": 0.9}');
    expect(r.suggestion).toBe('');
    expect(r.reasoning).toBe('');
  });

  it('throws CritiqueParseError on prose with no JSON', () => {
    expect(() => parseCritique('just some prose with no json at all')).toThrow(CritiqueParseError);
  });

  it('throws CritiqueParseError on JSON missing a usable score', () => {
    expect(() =>
      parseCritique('{"suggestion": "x", "reasoning": "y", "score": "not-a-number"}'),
    ).toThrow(CritiqueParseError);
  });
});
