/**
 * Typed error classes for @sovereignclaw/core.
 *
 * Per working agreement Section 19.8: no bare `throw new Error('...')` in
 * shipped code. Callers can `instanceof` these to handle specific failure modes.
 */

/** Base class. All core errors extend this so callers can catch broadly. */
export class CoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Base class for inference adapter failures. */
export class InferenceError extends CoreError {}

/** Router rejected the API key (HTTP 401). */
export class RouterAuthError extends InferenceError {
  constructor(message = 'Router authentication failed (HTTP 401)', options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** Router on-chain balance is insufficient (HTTP 402). */
export class RouterBalanceError extends InferenceError {
  constructor(
    public readonly depositUrl: string,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(
      message ??
        `Router rejected the request: insufficient balance. Deposit testnet 0G at ${depositUrl}.`,
      options,
    );
  }
}

/** Router returned an HTTP 4xx other than 401/402. */
export class RouterClientError extends InferenceError {
  constructor(
    public readonly status: number,
    public readonly body: string,
    options?: { cause?: unknown },
  ) {
    super(`Router HTTP ${status}: ${body.slice(0, 300)}`, options);
  }
}

/** Router returned an HTTP 5xx. */
export class RouterServerError extends InferenceError {
  constructor(
    public readonly status: number,
    public readonly body: string,
    options?: { cause?: unknown },
  ) {
    super(`Router HTTP ${status}: ${body.slice(0, 300)}`, options);
  }
}

/** Inference call timed out. */
export class InferenceTimeoutError extends InferenceError {
  constructor(timeoutMs: number, options?: { cause?: unknown }) {
    super(`Inference timed out after ${timeoutMs}ms`, options);
  }
}

/** Response body had no choices[].message.content. */
export class EmptyInferenceResponseError extends InferenceError {
  constructor(rawPreview: string, options?: { cause?: unknown }) {
    super(`Router returned no completion content. Preview: ${rawPreview.slice(0, 200)}`, options);
  }
}

/** Caller passed Direct-mode-only options to the Router-only Phase 1 adapter. */
export class DirectModeUnsupportedError extends InferenceError {
  constructor(option: string) {
    super(
      `Option '${option}' requires Direct mode (@0glabs/0g-serving-broker), ` +
        `which is not supported in this adapter version. See roadmap Section 7.4 for the fallback path.`,
    );
  }
}

/** Base class for tool failures. */
export class ToolError extends CoreError {}

/** Tool input failed Zod validation. */
export class ToolValidationError extends ToolError {
  constructor(
    public readonly toolName: string,
    public readonly zodIssues: unknown,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? `Tool '${toolName}' input failed schema validation`, options);
  }
}

/** Tool's run() function threw. The original error is in `cause`. */
export class ToolExecutionError extends ToolError {
  constructor(
    public readonly toolName: string,
    cause: unknown,
  ) {
    super(`Tool '${toolName}' threw during execution`, { cause });
  }
}

/** Tool timed out. */
export class ToolTimeoutError extends ToolError {
  constructor(toolName: string, timeoutMs: number) {
    super(`Tool '${toolName}' timed out after ${timeoutMs}ms`);
  }
}
