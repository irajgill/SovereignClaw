import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  OracleAuthError,
  OracleClient,
  OracleRevokedError,
  OracleTimeoutError,
  OracleUnreachableError,
} from '../src/index.js';

const URL = 'http://oracle.test';

describe('OracleClient', () => {
  let originalFetch: typeof fetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockResponse(init: { ok: boolean; status: number; body?: unknown; isJson?: boolean }) {
    const body =
      init.body === undefined
        ? ''
        : init.isJson === false
          ? String(init.body)
          : JSON.stringify(init.body);
    const headers = new Headers();
    if (init.isJson !== false) headers.set('content-type', 'application/json');
    return new Response(body, { status: init.status, headers });
  }

  it('GET /healthz hits the right URL with JSON Accept', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`${URL}/healthz`);
      expect(init?.method).toBe('GET');
      expect((init?.headers as Record<string, string>)['Accept']).toBe('application/json');
      return mockResponse({
        ok: true,
        status: 200,
        body: { ok: true, oracleAddress: '0x1', hasKey: true },
      });
    });
    globalThis.fetch = fetchMock as never;
    const c = new OracleClient({ url: URL });
    const r = await c.healthz();
    expect(r.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('POST /oracle/reencrypt sends body as JSON', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(`${URL}/oracle/reencrypt`);
      expect(init?.method).toBe('POST');
      expect(JSON.parse(init?.body as string)).toMatchObject({
        tokenId: '1',
        currentOwner: '0xabc',
        newOwner: '0xdef',
        newOwnerPubkey: '0x04aa',
      });
      return mockResponse({
        ok: true,
        status: 200,
        body: { newPointer: '0xaa', newWrappedDEK: '0xbb', proof: '0xcc' },
      });
    });
    globalThis.fetch = fetchMock as never;
    const c = new OracleClient({ url: URL });
    const r = await c.reencrypt({
      tokenId: '1',
      currentOwner: '0xabc',
      newOwner: '0xdef',
      newOwnerPubkey: '0x04aa',
    });
    expect(r).toEqual({ newPointer: '0xaa', newWrappedDEK: '0xbb', proof: '0xcc' });
  });

  it('appends Authorization: Bearer when authToken is set', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const auth = (init?.headers as Record<string, string>)['Authorization'];
      expect(auth).toBe('Bearer secret-token');
      return mockResponse({
        ok: true,
        status: 200,
        body: { address: '0x1', chainId: 1, agentNFT: '0x2' },
      });
    });
    globalThis.fetch = fetchMock as never;
    const c = new OracleClient({ url: URL, authToken: 'secret-token' });
    await c.pubkey();
  });

  it('maps HTTP 401 to OracleAuthError', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ ok: false, status: 401, body: 'unauthorized', isJson: false }),
    ) as never;
    const c = new OracleClient({ url: URL });
    await expect(c.pubkey()).rejects.toBeInstanceOf(OracleAuthError);
  });

  it('maps HTTP 410 to OracleRevokedError', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ ok: false, status: 410, body: 'gone', isJson: false }),
    ) as never;
    const c = new OracleClient({ url: URL });
    await expect(
      c.reencrypt({ tokenId: '1', currentOwner: '0x1', newOwner: '0x2', newOwnerPubkey: '0x04' }),
    ).rejects.toBeInstanceOf(OracleRevokedError);
  });

  it('maps other non-2xx to OracleHttpError with status', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ ok: false, status: 500, body: 'boom', isJson: false }),
    ) as never;
    const c = new OracleClient({ url: URL });
    await expect(c.pubkey()).rejects.toMatchObject({ name: 'OracleHttpError', status: 500 });
  });

  it('maps fetch network failure to OracleUnreachableError', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    }) as never;
    const c = new OracleClient({ url: URL });
    await expect(c.pubkey()).rejects.toBeInstanceOf(OracleUnreachableError);
  });

  it('maps abort to OracleTimeoutError', async () => {
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const ctrl = init?.signal as AbortSignal | undefined;
        ctrl?.addEventListener('abort', () => {
          const err = new Error('aborted');
          (err as { name?: string }).name = 'AbortError';
          reject(err);
        });
      });
    }) as never;
    const c = new OracleClient({ url: URL, timeoutMs: 50 });
    await expect(c.pubkey()).rejects.toBeInstanceOf(OracleTimeoutError);
  });

  it('rejects non-JSON responses', async () => {
    globalThis.fetch = vi.fn(async () =>
      mockResponse({ ok: true, status: 200, body: '<html></html>', isJson: false }),
    ) as never;
    const c = new OracleClient({ url: URL });
    await expect(c.pubkey()).rejects.toMatchObject({ name: 'OracleClientError' });
  });
});
