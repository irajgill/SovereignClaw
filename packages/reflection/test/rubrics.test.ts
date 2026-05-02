import { describe, expect, it } from 'vitest';
import {
  CRITIC_OUTPUT_SHAPE,
  CRITIC_SYSTEM_PROMPT,
  buildBuiltInRubricPrompt,
  buildCustomRubricPrompt,
  type BuiltInRubric,
} from '../src/rubrics.js';

const INPUT = 'Who wrote the Transformer paper?';
const OUTPUT = 'Vaswani et al., 2017.';

describe('built-in rubrics', () => {
  const rubrics: BuiltInRubric[] = ['accuracy', 'completeness', 'safety', 'concision'];

  it('produces a non-empty prompt for every built-in', () => {
    for (const r of rubrics) {
      const p = buildBuiltInRubricPrompt(r, INPUT, OUTPUT);
      expect(p).toContain(`Rubric: ${r}`);
      expect(p).toContain(INPUT);
      expect(p).toContain(OUTPUT);
      expect(p).toContain(CRITIC_OUTPUT_SHAPE);
    }
  });

  it('each rubric has a distinct guide body', () => {
    const prompts = rubrics.map((r) => buildBuiltInRubricPrompt(r, INPUT, OUTPUT));
    const unique = new Set(prompts);
    expect(unique.size).toBe(rubrics.length);
  });

  it('system prompt forbids markdown and code fences', () => {
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/no\s+markdown/i);
    expect(CRITIC_SYSTEM_PROMPT).toMatch(/no\s+code\s+fences/i);
  });
});

describe('custom rubric callback', () => {
  it('uses the callback output verbatim when it includes the output shape', () => {
    const cb = (o: string, i: string) =>
      `Judge by reading taste.\nQ: ${i}\nA: ${o}\n${CRITIC_OUTPUT_SHAPE}`;
    const p = buildCustomRubricPrompt(cb, INPUT, OUTPUT);
    expect(p).toContain('reading taste');
    expect(p).toContain(CRITIC_OUTPUT_SHAPE);
    expect(p).toContain(INPUT);
    expect(p).toContain(OUTPUT);
    // no duplication
    expect(p.split(CRITIC_OUTPUT_SHAPE).length - 1).toBe(1);
  });

  it('appends the output shape when the callback omits it', () => {
    const cb = (o: string, i: string) => `Judge by reading taste.\nQ: ${i}\nA: ${o}`;
    const p = buildCustomRubricPrompt(cb, INPUT, OUTPUT);
    expect(p).toContain(CRITIC_OUTPUT_SHAPE);
  });

  it('throws when callback returns empty string', () => {
    expect(() => buildCustomRubricPrompt(() => '', INPUT, OUTPUT)).toThrow(TypeError);
  });

  it('throws when callback returns non-string', () => {
    expect(() =>
      buildCustomRubricPrompt((): string => null as unknown as string, INPUT, OUTPUT),
    ).toThrow(TypeError);
  });
});
