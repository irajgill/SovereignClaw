/**
 * Inference round-trip benchmark — §16 deliverable.
 *
 * Measures cold-start + steady-state latency of the 0G Compute Router
 * doing a TEE-verified one-shot chat completion, exactly as
 * `sealed0GInference` uses it.
 *
 * Methodology:
 *   - N sequential requests (default 5) with the same prompt + model.
 *   - The FIRST request is called "cold": fresh TCP, no warm caches on
 *     the provider, no keep-alive. The remaining are "warm" (we keep
 *     the same process so any connection pools stay alive).
 *   - We record per-request wall time and the router's reported
 *     `tee_verified` flag. The cold target is <8s per §16; we report
 *     both the cold number and the warm median.
 *   - No retries. A failed request aborts the benchmark so the number
 *     we publish is always from a clean sweep.
 *
 * Output: `scripts/.benchmarks/inference-rtt.json` + console summary.
 *
 * Usage:
 *   pnpm benchmark:inference-rtt              # default N=5 warm-ups
 *   pnpm benchmark:inference-rtt --n 10       # 10 samples
 *   pnpm benchmark:inference-rtt --prompt "x" # override default prompt
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './lib/env.js';

const here = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(here, '.benchmarks');
const reportPath = resolve(reportDir, 'inference-rtt.json');

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  return argv[i + 1];
}
const N = Number(argValue('--n') ?? 3);
const DEFAULT_PROMPT = 'What year was the Transformer paper published? One short sentence.';
const PROMPT = argValue('--prompt') ?? DEFAULT_PROMPT;
/**
 * Inter-call spacing to stay under provider rate limits on the free
 * testnet router. Override with --delay-ms on self-hosted routers.
 */
const DELAY_MS = Number(argValue('--delay-ms') ?? 2000);

interface Sample {
  index: number;
  elapsedMs: number;
  teeVerified: boolean | null;
  promptTokens?: number;
  completionTokens?: number;
  replyPreview: string;
}

interface ChatCompletionResponse {
  choices: Array<{ message: { content: string } }>;
  model?: string;
  usage?: { prompt_tokens: number; completion_tokens: number };
  trace?: { tee_verified?: boolean | null };
  tee_verified?: boolean | null;
}

async function callOnce(env: ReturnType<typeof loadEnv>, index: number): Promise<Sample> {
  const url = `${env.COMPUTE_ROUTER_BASE_URL}/chat/completions`;
  const start = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.COMPUTE_ROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.COMPUTE_MODEL,
      messages: [
        { role: 'system', content: 'You answer in exactly one short sentence.' },
        { role: 'user', content: PROMPT },
      ],
      max_tokens: 64,
      temperature: 0,
      verify_tee: true,
    }),
  });
  const elapsedMs = Date.now() - start;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`inference-rtt: HTTP ${res.status} ${res.statusText} — ${text.slice(0, 300)}`);
  }
  const data = (await res.json()) as ChatCompletionResponse;
  const reply = data.choices?.[0]?.message?.content?.trim() ?? '';
  const teeVerifiedRaw = data.trace?.tee_verified ?? data.tee_verified ?? null;
  const teeVerified = typeof teeVerifiedRaw === 'boolean' ? teeVerifiedRaw : null;
  return {
    index,
    elapsedMs,
    teeVerified,
    promptTokens: data.usage?.prompt_tokens,
    completionTokens: data.usage?.completion_tokens,
    replyPreview: reply.slice(0, 80),
  };
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1]! + sorted[mid]!) / 2) : sorted[mid]!;
}

async function main(): Promise<void> {
  const env = loadEnv();
  console.log(`inference-rtt benchmark: N=${N} model=${env.COMPUTE_MODEL}`);
  const samples: Sample[] = [];
  for (let i = 0; i < N; i++) {
    if (i > 0 && DELAY_MS > 0) await new Promise((r) => setTimeout(r, DELAY_MS));
    const s = await callOnce(env, i);
    samples.push(s);
    console.log(
      `  [${i === 0 ? 'cold' : 'warm'}] #${i}  ${s.elapsedMs.toString().padStart(5)}ms  tee=${s.teeVerified}  tokens=${s.promptTokens ?? '?'}+${s.completionTokens ?? '?'}  "${s.replyPreview}"`,
    );
  }

  const cold = samples[0]!.elapsedMs;
  const warm = samples.slice(1).map((s) => s.elapsedMs);
  const warmMedian = median(warm);
  const warmMin = warm.length > 0 ? Math.min(...warm) : 0;
  const warmMax = warm.length > 0 ? Math.max(...warm) : 0;
  const coldTargetMs = 8000;

  console.log();
  console.log('  cold             ', `${cold}ms`);
  console.log('  warm median      ', warm.length > 0 ? `${warmMedian}ms` : '(n/a)');
  console.log('  warm min / max   ', warm.length > 0 ? `${warmMin}ms / ${warmMax}ms` : '(n/a)');
  console.log('  cold target      ', `${coldTargetMs}ms  ${cold <= coldTargetMs ? 'yes' : 'NO'}`);
  console.log();

  const report = {
    version: 1,
    benchmark: 'inference-rtt',
    capturedAt: new Date().toISOString(),
    node: process.version,
    model: env.COMPUTE_MODEL,
    router: env.COMPUTE_ROUTER_BASE_URL,
    prompt: PROMPT,
    samples,
    summary: {
      n: samples.length,
      coldMs: cold,
      warmMedianMs: warmMedian,
      warmMinMs: warmMin,
      warmMaxMs: warmMax,
      coldTargetMs,
      coldOk: cold <= coldTargetMs,
      teeVerifiedAll: samples.every((s) => s.teeVerified === true),
    },
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`report written to ${reportPath}`);
}

main().catch((err) => {
  console.error('inference-rtt benchmark FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
