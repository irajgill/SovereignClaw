import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DirectModeUnsupportedError,
  EmptyInferenceResponseError,
  InferenceTimeoutError,
  RouterAuthError,
  RouterBalanceError,
  RouterClientError,
  RouterServerError,
} from '../src/errors.js';
import { sealed0GInference, type InferenceOptions } from '../src/inference.js';

const baseOpts: InferenceOptions = {
  model: 'qwen/qwen-2.5-7b-instruct',
  apiKey: 'sk-test',
  baseUrl: 'https://router.example.test/v1',
  timeoutMs: 1_000,
  retries: { count: 0, backoffMs: 1 },
};

function makeRouterResponse(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'chatcmpl-abc',
    model: 'qwen2.5-7b-instruct',
    object: 'chat.completion',
    created: 1777738566,
    choices: [
      {
        finish_reason: 'stop',
        index: 0,
        message: { role: 'assistant', content: 'Hello, SovereignClaw!' },
      },
    ],
    usage: { prompt_tokens: 29, completion_tokens: 7, total_tokens: 36 },
    x_0g_trace: {
      provider: '0xa48f01287233509FD694a22Bf840225062E67836',
      request_id: '0ebefd3f-0486-4076-97d3-9be050b657d4',
      tee_verified: true,
      billing: {
        input_cost: '1450000000000',
        output_cost: '700000000000',
        total_cost: '2150000000000',
      },
    },
    ...overrides,
  };
}

function mockFetchOnce(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      statusText: 'mock',
      text: async (): Promise<string> => JSON.stringify(body),
      json: async (): Promise<unknown> => body,
    }) as unknown as typeof fetch,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sealed0GInference happy path', () => {
  it('parses a typical Router response and surfaces all fields', async () => {
    mockFetchOnce(200, makeRouterResponse());
    const adapter = sealed0GInference(baseOpts);
    const result = await adapter.run([{ role: 'user', content: 'hi' }]);

    expect(result.text).toBe('Hello, SovereignClaw!');
    expect(result.model).toBe('qwen2.5-7b-instruct');
    expect(result.usage).toEqual({
      promptTokens: 29,
      completionTokens: 7,
      totalTokens: 36,
    });
    expect(result.attestation.teeVerified).toBe(true);
    expect(result.attestation.providerAddress).toBe('0xa48f01287233509FD694a22Bf840225062E67836');
    expect(result.attestation.requestId).toBe('0ebefd3f-0486-4076-97d3-9be050b657d4');
    expect(result.billing.inputCost).toBe(1450000000000n);
    expect(result.billing.outputCost).toBe(700000000000n);
    expect(result.billing.totalCost).toBe(2150000000000n);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.raw).toBeDefined();
  });

  it('sends verify_tee=true by default', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async (): Promise<string> => '',
      json: async (): Promise<unknown> => makeRouterResponse(),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await sealed0GInference(baseOpts).run([{ role: 'user', content: 'hi' }]);

    const callArgs = fetchMock.mock.calls[0]!;
    const sentBody = JSON.parse(callArgs[1].body as string);
    expect(sentBody.verify_tee).toBe(true);
    expect(sentBody.model).toBe('qwen/qwen-2.5-7b-instruct');
  });

  it('omits verify_tee when verifiable=false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async (): Promise<string> => '',
      json: async (): Promise<unknown> => makeRouterResponse(),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await sealed0GInference({ ...baseOpts, verifiable: false }).run([
      { role: 'user', content: 'hi' },
    ]);

    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sentBody.verify_tee).toBeUndefined();
  });

  it('passes providerHint through as the provider field', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async (): Promise<string> => '',
      json: async (): Promise<unknown> => makeRouterResponse(),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await sealed0GInference({
      ...baseOpts,
      providerHint: { sort: 'latency', allow_fallbacks: true },
    }).run([{ role: 'user', content: 'hi' }]);

    const sentBody = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sentBody.provider).toEqual({ sort: 'latency', allow_fallbacks: true });
  });
});

describe('sealed0GInference degraded responses', () => {
  it('handles missing x_0g_trace gracefully', async () => {
    mockFetchOnce(200, {
      choices: [{ message: { content: 'hi' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    });
    const result = await sealed0GInference(baseOpts).run([{ role: 'user', content: 'hi' }]);
    expect(result.attestation.teeVerified).toBeNull();
    expect(result.attestation.providerAddress).toBeNull();
    expect(result.billing.totalCost).toBe(0n);
  });

  it('handles tee_verified=false', async () => {
    mockFetchOnce(
      200,
      makeRouterResponse({
        x_0g_trace: { tee_verified: false, provider: '0xabc', request_id: 'r' },
      }),
    );
    const result = await sealed0GInference(baseOpts).run([{ role: 'user', content: 'hi' }]);
    expect(result.attestation.teeVerified).toBe(false);
  });

  it('throws EmptyInferenceResponseError when content is missing', async () => {
    mockFetchOnce(200, { choices: [{ message: { content: '' } }] });
    await expect(
      sealed0GInference(baseOpts).run([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(EmptyInferenceResponseError);
  });
});

describe('sealed0GInference HTTP error mapping', () => {
  it('maps 401 to RouterAuthError', async () => {
    mockFetchOnce(401, { error: 'unauthorized' });
    await expect(
      sealed0GInference(baseOpts).run([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(RouterAuthError);
  });

  it('maps 402 to RouterBalanceError with deposit URL', async () => {
    mockFetchOnce(402, { error: 'insufficient' });
    try {
      await sealed0GInference(baseOpts).run([{ role: 'user', content: 'hi' }]);
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RouterBalanceError);
      expect((err as RouterBalanceError).depositUrl).toBe('https://pc.testnet.0g.ai');
    }
  });

  it('uses a custom depositUrl when provided', async () => {
    mockFetchOnce(402, { error: 'insufficient' });
    try {
      await sealed0GInference({ ...baseOpts, depositUrl: 'https://custom/' }).run([
        { role: 'user', content: 'hi' },
      ]);
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as RouterBalanceError).depositUrl).toBe('https://custom/');
    }
  });

  it('maps 404 to RouterClientError', async () => {
    mockFetchOnce(404, { error: 'model not found' });
    await expect(
      sealed0GInference(baseOpts).run([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(RouterClientError);
  });

  it('maps 500 to RouterServerError', async () => {
    mockFetchOnce(500, { error: 'server' });
    await expect(
      sealed0GInference(baseOpts).run([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(RouterServerError);
  });
});

describe('sealed0GInference retries and timeouts', () => {
  it('retries 5xx up to retries.count then throws', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async (): Promise<string> => 'svc unavailable',
        json: async (): Promise<unknown> => ({}),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async (): Promise<string> => 'still unavailable',
        json: async (): Promise<unknown> => ({}),
      });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(
      sealed0GInference({
        ...baseOpts,
        retries: { count: 1, backoffMs: 1 },
      }).run([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(RouterServerError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not retry 4xx', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 402,
      text: async (): Promise<string> => 'insufficient',
      json: async (): Promise<unknown> => ({}),
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(
      sealed0GInference({
        ...baseOpts,
        retries: { count: 3, backoffMs: 1 },
      }).run([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(RouterBalanceError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws InferenceTimeoutError when fetch is aborted', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        throw err;
      }) as unknown as typeof fetch,
    );

    await expect(
      sealed0GInference({
        ...baseOpts,
        timeoutMs: 50,
        retries: { count: 0, backoffMs: 1 },
      }).run([{ role: 'user', content: 'hi' }]),
    ).rejects.toBeInstanceOf(InferenceTimeoutError);
  });
});

describe('sealed0GInference Direct mode guard', () => {
  it('throws DirectModeUnsupportedError if providerAddress is set', () => {
    expect(() =>
      sealed0GInference({
        ...baseOpts,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        providerAddress: '0xabc' as any,
      }),
    ).toThrow(DirectModeUnsupportedError);
  });
});
