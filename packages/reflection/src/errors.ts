/**
 * Typed errors for @sovereignclaw/reflection.
 *
 * Mirrors the approach used in @sovereignclaw/core and @sovereignclaw/mesh:
 * callers catch a base class (`ReflectionError`) and `instanceof`-check
 * specific subtypes when they want to handle individual failures.
 */

export class ReflectionError extends Error {
  override readonly name: string = 'ReflectionError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class CritiqueParseError extends ReflectionError {
  override readonly name: string = 'CritiqueParseError';
  constructor(raw: string) {
    super(`critic output did not parse to {score, suggestion, reasoning}: ${raw.slice(0, 200)}`);
  }
}

export class LearningPersistError extends ReflectionError {
  override readonly name: string = 'LearningPersistError';
  constructor(cause: unknown) {
    super(`failed to persist learning record to history`, { cause: cause as Error });
  }
}

export class InvalidReflectionConfigError extends ReflectionError {
  override readonly name: string = 'InvalidReflectionConfigError';
}
