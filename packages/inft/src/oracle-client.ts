/**
 * Talks to the dev oracle service in `apps/backend/src/routes/oracle/`.
 *
 * Uses the global `fetch` (Node 22+). Every request has an `AbortController`
 * timeout. 4xx/5xx and network failures throw typed `OracleClient*` errors.
 */
import {
  OracleAuthError,
  OracleClientError,
  OracleHttpError,
  OracleRevokedError,
  OracleTimeoutError,
  OracleUnreachableError,
} from './errors.js';

export interface OracleClientOptions {
  /** Base URL of the oracle, e.g. `http://localhost:8787`. No trailing slash. */
  url: string;
  /** Optional bearer auth header value (without the "Bearer " prefix). */
  authToken?: string;
  /** Per-request timeout in ms. Default 30s. */
  timeoutMs?: number;
}

export interface OraclePubkey {
  address: string;
  chainId: number;
  agentNFT: string;
}

export interface ReencryptRequest {
  tokenId: string;
  currentOwner: string;
  newOwner: string;
  newOwnerPubkey: string;
}

export interface ReencryptResponse {
  newPointer: string;
  newWrappedDEK: string;
  /** ABI-encoded `OracleProof` ready to pass to `transferWithReencryption`. */
  proof: string;
}

export interface RevokeRequest {
  tokenId: string;
  owner: string;
  ownerSig: string;
  oldKeyHash: string;
}

export interface RevokeResponse {
  proof: string;
}

export interface ProveRequest {
  action: 'transfer' | 'revoke';
  tokenId: string;
  from: string;
  to: string;
  newPointer: string;
  dataHash: string;
  nonce: string;
}

export interface ProveResponse {
  proof: string;
}

export class OracleClient {
  private readonly url: string;
  private readonly authToken: string | undefined;
  private readonly timeoutMs: number;

  constructor(opts: OracleClientOptions) {
    this.url = opts.url.replace(/\/+$/, '');
    this.authToken = opts.authToken;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  pubkey(): Promise<OraclePubkey> {
    return this.request<OraclePubkey>('GET', '/oracle/pubkey');
  }

  reencrypt(body: ReencryptRequest): Promise<ReencryptResponse> {
    return this.request<ReencryptResponse>('POST', '/oracle/reencrypt', body);
  }

  revoke(body: RevokeRequest): Promise<RevokeResponse> {
    return this.request<RevokeResponse>('POST', '/oracle/revoke', body);
  }

  prove(body: ProveRequest): Promise<ProveResponse> {
    return this.request<ProveResponse>('POST', '/oracle/prove', body);
  }

  healthz(): Promise<{
    ok: boolean;
    oracleAddress: string;
    hasKey: boolean;
    chainId?: number;
    agentNFT?: string;
    revokedCount?: number;
  }> {
    return this.request('GET', '/healthz');
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const url = `${this.url}${path}`;
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.authToken) headers['Authorization'] = `Bearer ${this.authToken}`;

    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === 'AbortError') {
        throw new OracleTimeoutError(
          `oracle: ${method} ${url} timed out after ${this.timeoutMs}ms`,
        );
      }
      throw new OracleUnreachableError(
        `oracle: ${method} ${url} unreachable: ${e.message ?? String(err)}`,
        {
          cause: err as Error,
        },
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const message = `oracle: ${method} ${path} ${res.status} ${res.statusText}: ${text || '(no body)'}`;
      if (res.status === 401) throw new OracleAuthError(message);
      if (res.status === 410) throw new OracleRevokedError(message);
      throw new OracleHttpError(message, res.status);
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      throw new OracleClientError(
        `oracle: ${method} ${path} returned non-JSON content-type "${contentType}": ${text.slice(0, 200)}`,
        res.status,
      );
    }
    return (await res.json()) as T;
  }
}
