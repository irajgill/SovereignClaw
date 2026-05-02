/**
 * @sovereignclaw/reflection - self-critique and learning persistence.
 *
 * Public exports as of Phase 6 v0:
 *   - reflectOnOutput({ rounds, critic, rubric, persistLearnings, threshold })
 *   - Built-in rubric types + custom rubric callback type
 *   - parseCritique() helper
 *   - Learning record types + persistLearning helper
 *   - Typed errors
 */
export const VERSION = '0.0.0';

export { reflectOnOutput, type ReflectOnOutputOptions } from './reflect.js';

export {
  CRITIC_OUTPUT_SHAPE,
  CRITIC_SYSTEM_PROMPT,
  buildBuiltInRubricPrompt,
  buildCustomRubricPrompt,
  type BuiltInRubric,
  type CustomRubric,
} from './rubrics.js';

export { parseCritique, type ParsedCritique } from './parser.js';

export { learningKey, persistLearning, type LearningRecordV1 } from './learning.js';

export {
  CritiqueParseError,
  InvalidReflectionConfigError,
  LearningPersistError,
  ReflectionError,
} from './errors.js';
