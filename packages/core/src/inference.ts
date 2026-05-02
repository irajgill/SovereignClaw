/**
 * sealed0GInference - the inference adapter for @sovereignclaw/core.
 *
 * Wraps the 0G Compute Router and surfaces typed attestation, billing, usage,
 * latency, and text result data.
 */
import {
  DirectModeUnsupportedError,
  EmptyInferenceResponseError,
  InferenceTimeoutError,
  RouterAuthError,
  RouterBalanceError,
  RouterClientError,
  RouterServerError,
} from './errors.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface InferenceOptions {
  model: string;
  apiKey: string;
  baseUrl?: string;
  verifiable?: boolean;
  providerHint?: Record<string, unknown>;
  timeoutMs?: number;
  retries?: { count: number; backoffMs: number };
  depositUrl?: string;
  providerAddress?: never;
}

export interface BillingInfo {
  inputCost: bigint;
  outputCost: bigint;
  totalCost: bigint;
}

export interface Attestation {
  teeVerified: boolean | null;
  providerAddress: string | null;
  requestId: string | null;
}

export interface InferenceResult {
  model: string;
  text: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  attestation: Attestation;
  billing: BillingInfo;
  latencyMs: number;
  raw: unknown;
}

export interface InferenceAdapter {
  run(
    messages: ChatMessage[],
    options?: { maxTokens?: number; temperature?: number },
  ): Promise<InferenceResult>;
}

interface RouterResponse {
  id?: string;
  model?: string;
  object?: string;
  created?: number;
  choices?: Array<{
    index?: number;
    finish_reason?: string;
    message?: { role?: string; content?: string };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  x_0g_trace?: {
    request_id?: string;
    provider?: string;
    tee_verified?: boolean | null;
    billing?: {
      input_cost?: string;
      output_cost?: string;
      total_cost?: string;
    };
  };
}

const DEFAULT_BASE_URL = 'https://router-api-testnet.integratenetwork.work/v1';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_DEPOSIT_URL = 'https://pc.testnet.0g.ai';

function bigintFromWei(value: string | undefined): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export function sealed0GInference(opts: InferenceOptions): InferenceAdapter {
  const providerAddressValue = (opts as unknown as { providerAddress?: unknown }).providerAddress;
  if (providerAddressValue !== undefined) {
    throw new DirectModeUnsupportedError('providerAddress');
  }

  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const verifiable = opts.verifiable ?? true;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const depositUrl = opts.depositUrl ?? DEFAULT_DEPOSIT_URL;
  const retryCount = opts.retries?.count ?? 2;
  const retryBackoffMs = opts.retries?.backoffMs ?? 500;

  return {
    async run(messages, runOpts): Promise<InferenceResult> {
      const url = `${baseUrl}/chat/completions`;
      const body: Record<string, unknown> = {
        model: opts.model,
        messages,
        max_tokens: runOpts?.maxTokens ?? 512,
        temperature: runOpts?.temperature ?? 0,
      };
      if (verifiable) body.verify_tee = true;
      if (opts.providerHint) body.provider = opts.providerHint;

      const start = Date.now();
      const data = await callWithRetry({
        url,
        body,
        apiKey: opts.apiKey,
        timeoutMs,
        retryCount,
        retryBackoffMs,
        depositUrl,
      });
      const latencyMs = Date.now() - start;

      const text = data.choices?.[0]?.message?.content?.trim() ?? '';
      if (!text) {
        throw new EmptyInferenceResponseError(JSON.stringify(data));
      }

      const trace = data.x_0g_trace ?? {};
      const billingRaw = trace.billing ?? {};

      return {
        model: data.model ?? opts.model,
        text,
        usage:
          data.usage?.prompt_tokens !== undefined &&
          data.usage?.completion_tokens !== undefined &&
          data.usage?.total_tokens !== undefined
            ? {
                promptTokens: data.usage.prompt_tokens,
                completionTokens: data.usage.completion_tokens,
                totalTokens: data.usage.total_tokens,
              }
            : undefined,
        attestation: {
          teeVerified: typeof trace.tee_verified === 'boolean' ? trace.tee_verified : null,
          providerAddress: trace.provider ?? null,
          requestId: trace.request_id ?? null,
        },
        billing: {
          inputCost: bigintFromWei(billingRaw.input_cost),
          outputCost: bigintFromWei(billingRaw.output_cost),
          totalCost: bigintFromWei(billingRaw.total_cost),
        },
        latencyMs,
        raw: data,
      };
    },
  };
}

interface CallArgs {
  url: string;
  body: Record<string, unknown>;
  apiKey: string;
  timeoutMs: number;
  retryCount: number;
  retryBackoffMs: number;
  depositUrl: string;
}

async function callWithRetry(args: CallArgs): Promise<RouterResponse> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= args.retryCount; attempt += 1) {
    try {
      return await callOnce(args);
    } catch (err) {
      if (
        err instanceof RouterAuthError ||
        err instanceof RouterBalanceError ||
        err instanceof RouterClientError ||
        err instanceof EmptyInferenceResponseError
      ) {
        throw err;
      }
      lastError = err;
      if (attempt < args.retryCount) {
        const backoff = args.retryBackoffMs * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, backoff));
      }
    }
  }
  throw lastError;
}

async function callOnce(args: CallArgs): Promise<RouterResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeoutMs);
  let res: Response;
  try {
    res = await fetch(args.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${args.apiKey}`,
      },
      body: JSON.stringify(args.body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new InferenceTimeoutError(args.timeoutMs, { cause: err });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    if (res.status === 401) throw new RouterAuthError(undefined);
    if (res.status === 402) throw new RouterBalanceError(args.depositUrl);
    if (res.status >= 500) throw new RouterServerError(res.status, text);
    throw new RouterClientError(res.status, text);
  }

  return (await res.json()) as RouterResponse;
}
