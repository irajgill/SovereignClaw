/**
 * Typed errors for @sovereignclaw/inft. Per working agreement §19.8, no
 * shipped code throws bare `Error('...')`. Callers can match by class.
 */

export class InftError extends Error {
  override readonly name: string = 'InftError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
  }
}

export class MintError extends InftError {
  override readonly name = 'MintError';
}

export class TransferError extends InftError {
  override readonly name = 'TransferError';
}

export class RevokeError extends InftError {
  override readonly name = 'RevokeError';
}

export class RecordUsageError extends InftError {
  override readonly name = 'RecordUsageError';
}

export class OracleClientError extends InftError {
  override readonly name: string = 'OracleClientError';
  constructor(
    message: string,
    readonly status: number | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class OracleUnreachableError extends OracleClientError {
  override readonly name = 'OracleUnreachableError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, undefined, options);
  }
}

export class OracleTimeoutError extends OracleClientError {
  override readonly name = 'OracleTimeoutError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, undefined, options);
  }
}

/** HTTP 410 from /oracle/reencrypt: the token has been revoked. */
export class OracleRevokedError extends OracleClientError {
  override readonly name = 'OracleRevokedError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, 410, options);
  }
}

/** HTTP 401 from any oracle endpoint. */
export class OracleAuthError extends OracleClientError {
  override readonly name = 'OracleAuthError';
  constructor(message: string, options?: ErrorOptions) {
    super(message, 401, options);
  }
}

/** Non-2xx oracle response that didn't match a more specific subclass. */
export class OracleHttpError extends OracleClientError {
  override readonly name = 'OracleHttpError';
}

export class ContractRevertError extends InftError {
  override readonly name = 'ContractRevertError';
  constructor(
    message: string,
    readonly txHash: string | undefined,
    readonly reason: string | undefined,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export class DeploymentNotFoundError extends InftError {
  override readonly name = 'DeploymentNotFoundError';
}
