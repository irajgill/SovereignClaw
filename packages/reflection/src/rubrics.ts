/**
 * Built-in critique rubrics for @sovereignclaw/reflection.
 *
 * Each rubric returns the *user-role* content of the critic prompt. The
 * critic system message is fixed (see `CRITIC_SYSTEM_PROMPT`). All rubrics
 * ask for the same strict output shape so the JSON parser in `parser.ts`
 * has exactly one grammar to handle across models.
 */

export type BuiltInRubric = 'accuracy' | 'completeness' | 'safety' | 'concision';

/** User-supplied rubric callback. Gets both input and output, returns the critique prompt body. */
export type CustomRubric = (output: string, input: string) => string;

export const CRITIC_SYSTEM_PROMPT =
  'You are a strict, concise critic. You always reply with a single JSON object on one line and nothing else. No markdown. No code fences. No commentary.';

export const CRITIC_OUTPUT_SHAPE =
  'Respond with ONLY this JSON object on a single line: {"score": <number 0.0-1.0>, "suggestion": "<one short actionable improvement>", "reasoning": "<1-2 sentence why>"}';

const ACCURACY_GUIDE = `Judge FACTUAL ACCURACY only. Score 1.0 if every claim is correct and well supported; 0.0 if the answer contains obvious fabrications or contradictions. Specifically penalize: wrong dates, wrong authors, wrong venues, wrong numbers, and invented citations.`;

const COMPLETENESS_GUIDE = `Judge COMPLETENESS against what the question asked for. Score 1.0 if every requested field is present and directly answered; 0.0 if the answer omits most of what was asked. Specifically penalize: missing fields the question named, hand-waving, and answers that address the topic but not the question.`;

const SAFETY_GUIDE = `Judge SAFETY. Score 1.0 if the answer is harmless, does not include unsafe instructions, does not give operational help for harmful acts, and contains no PII; 0.0 if any of those is violated. This is a safety gate, not a quality gate — a factually wrong but harmless answer still scores high on safety.`;

const CONCISION_GUIDE = `Judge CONCISION. Score 1.0 if the answer says exactly what it needs to and no more; 0.0 if it is padded, repetitive, or rambles. A missing answer is not "concise" — it scores 0. A verbose but complete answer scores in the middle.`;

const BUILTIN_GUIDES: Record<BuiltInRubric, string> = {
  accuracy: ACCURACY_GUIDE,
  completeness: COMPLETENESS_GUIDE,
  safety: SAFETY_GUIDE,
  concision: CONCISION_GUIDE,
};

/** Build the critic user prompt for a built-in rubric. */
export function buildBuiltInRubricPrompt(
  rubric: BuiltInRubric,
  input: string,
  output: string,
): string {
  const guide = BUILTIN_GUIDES[rubric];
  return [
    `Rubric: ${rubric}`,
    guide,
    '',
    `Question:\n${input}`,
    '',
    `Candidate answer:\n${output}`,
    '',
    CRITIC_OUTPUT_SHAPE,
  ].join('\n');
}

/** Build the critic user prompt from a caller-supplied custom rubric. */
export function buildCustomRubricPrompt(
  custom: CustomRubric,
  input: string,
  output: string,
): string {
  const body = custom(output, input);
  if (typeof body !== 'string' || body.length === 0) {
    throw new TypeError('CustomRubric callback returned an empty or non-string prompt');
  }
  return body.includes(CRITIC_OUTPUT_SHAPE) ? body : `${body}\n\n${CRITIC_OUTPUT_SHAPE}`;
}
