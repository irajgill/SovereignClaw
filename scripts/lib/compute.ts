/**
 * Phase 0 compute smoke: send a one-shot chat completion through the 0G
 * Compute Router with TEE verification turned on. The Router is
 * OpenAI-compatible, so we just `fetch`. No SDK install needed for Phase 0.
 *
 * The `verify_tee: true` flag asks the Router to return on-chain signature
 * verification metadata in the response trace. Confirmed-supported by the
 * pinned model (qwen/qwen-2.5-7b-instruct) per the testnet dashboard.
 *
 * Phase 1 architectural note: this partially closes the Router-vs-Direct
 * gap noted in dev-log.md - Router does expose per-call TEE attestation
 * when verify_tee=true. See dev-log.md for the full Phase 1 decision.
 */
import type { Env } from './env.js';
import { logger } from './logger.js';

export interface ComputeSmokeResult {
  model: string;
  reply: string;
  teeVerified: boolean | null;
  teeVerifiedRaw: unknown;
  promptTokens?: number;
  completionTokens?: number;
  latencyMs: number;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  trace?: { tee_verified?: boolean | null } & Record<string, unknown>;
  tee_verified?: boolean | null;
}

export async function smokeCompute(env: Env): Promise<ComputeSmokeResult> {
  const url = `${env.COMPUTE_ROUTER_BASE_URL}/chat/completions`;
  const body = {
    model: env.COMPUTE_MODEL,
    messages: [
      { role: 'system', content: 'You answer in exactly one short sentence.' },
      { role: 'user', content: 'Say hello to SovereignClaw.' },
    ],
    max_tokens: 64,
    temperature: 0,
    verify_tee: true,
  };

  logger.info({ model: env.COMPUTE_MODEL, url, verifyTee: true }, 'compute: starting inference');
  const start = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.COMPUTE_ROUTER_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`compute: HTTP ${res.status} ${res.statusText} - ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as ChatCompletionResponse;
  const reply = data.choices?.[0]?.message?.content?.trim() ?? '';
  if (!reply) throw new Error(`compute: empty reply - raw=${JSON.stringify(data).slice(0, 500)}`);

  const teeVerifiedRaw = data.trace?.tee_verified ?? data.tee_verified ?? null;
  const teeVerified = typeof teeVerifiedRaw === 'boolean' ? teeVerifiedRaw : null;

  const latencyMs = Date.now() - start;
  logger.info(
    {
      latencyMs,
      teeVerified,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
      replyPreview: reply.slice(0, 80),
    },
    'compute: inference ok',
  );

  if (teeVerified === null) {
    logger.warn(
      'compute: response did not include tee_verified at expected paths; check raw shape',
    );
  } else if (teeVerified === false) {
    logger.warn('compute: tee_verified=false - provider responded but TEE attestation failed');
  }

  return {
    model: data.model ?? env.COMPUTE_MODEL,
    reply,
    teeVerified,
    teeVerifiedRaw,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
    latencyMs,
  };
}
