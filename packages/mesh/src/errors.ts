/**
 * Typed errors for @sovereignclaw/mesh.
 *
 * All mesh-layer failures extend `MeshError` so callers can `catch (err:
 * MeshError)` without a string sniff. Downstream providers and agents throw
 * their own types (MemoryError, InferenceError) — we do not re-wrap those
 * unless additional context is warranted.
 */
export class MeshError extends Error {
  override readonly name: string = 'MeshError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class BusAppendError extends MeshError {
  override readonly name: string = 'BusAppendError';
}

export class BusReplayError extends MeshError {
  override readonly name: string = 'BusReplayError';
}

export class MeshClosedError extends MeshError {
  override readonly name: string = 'MeshClosedError';
  constructor(meshId: string) {
    super(`Mesh (id='${meshId}') has been closed`);
  }
}

export class PatternError extends MeshError {
  override readonly name: string = 'PatternError';
}

export class EmptyAgentOutputError extends PatternError {
  override readonly name: string = 'EmptyAgentOutputError';
  constructor(role: string, phase: string) {
    super(`Agent (role='${role}') returned null/empty output during '${phase}'`);
  }
}

export class MaxRoundsExceededError extends PatternError {
  override readonly name: string = 'MaxRoundsExceededError';
  constructor(rounds: number, bestScore: number) {
    super(
      `planExecuteCritique: ran ${rounds} round(s) without reaching acceptance threshold (best score=${bestScore.toFixed(2)})`,
    );
  }
}

export class CritiqueParseError extends PatternError {
  override readonly name: string = 'CritiqueParseError';
  constructor(raw: string) {
    super(`critic output did not parse to {score, suggestion, reasoning}: ${raw.slice(0, 160)}`);
  }
}
