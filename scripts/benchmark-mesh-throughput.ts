/**
 * Mesh throughput benchmark — §16 deliverable.
 *
 * Runs `planExecuteCritique` N times sequentially (same 3-agent mesh,
 * different tasks) and reports tasks/second. This is a FULL end-to-end
 * measurement against the real 0G Compute Router — no mocks, no warm
 * caches, no shortcuts.
 *
 * Methodology:
 *   - One shared `Mesh` + three `Agent`s (planner/executor/critic) for
 *     the whole run. We do not tear down between tasks, so connection
 *     pools and the router's model-session warm state stay alive.
 *   - Each task is a small, factual question. Tasks are independent —
 *     no task depends on the output of another.
 *   - The bus uses in-memory storage (not 0G Log) to isolate the mesh
 *     coordination latency from storage latency. `sealed0GInference`
 *     still hits the real router for TEE-verified chat completions.
 *     (A separate benchmark will pin the end-to-end number with the
 *     full encrypted OG_Log bus — tracked as carryover.)
 *   - Per task, we capture: elapsedMs, rounds, accepted score. The
 *     summary reports median and tasks/second.
 *
 * Output: `scripts/.benchmarks/mesh-throughput.json` + console summary.
 *
 * Usage:
 *   pnpm benchmark:mesh-throughput             # default N=5 tasks
 *   pnpm benchmark:mesh-throughput --n 10
 *   pnpm benchmark:mesh-throughput --max-rounds 1
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';
import { Mesh, MaxRoundsExceededError, planExecuteCritique } from '@sovereignclaw/mesh';

const here = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(here, '.benchmarks');
const reportPath = resolve(reportDir, 'mesh-throughput.json');

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  return argv[i + 1];
}
const N = Number(argValue('--n') ?? 3);
const MAX_ROUNDS = Number(argValue('--max-rounds') ?? 1);
const ACCEPT_THRESHOLD = Number(argValue('--accept') ?? 0.7);
/**
 * Inter-task delay to stay under provider rate limits. The 0G Compute
 * Router's free testnet tier currently caps at ~3 requests / short
 * window per key; with maxRounds=1 each task spends 3 calls (planner +
 * executor + critic), so a small wait between tasks avoids 429s.
 * Self-hosted / paid tiers can pass --task-delay-ms 0.
 */
const TASK_DELAY_MS = Number(argValue('--task-delay-ms') ?? 30_000);

const TASKS: string[] = [
  'Name the 2017 paper that introduced the Transformer architecture. Author + year + venue. One sentence each.',
  'What is the capital of Mongolia? One short sentence.',
  'Who won the 2010 Fields Medal for work on dynamics of exceptional holonomy? One sentence.',
  'In what year was the HTTP/2 specification published as RFC 7540? One sentence.',
  'What is the default TCP port for PostgreSQL? One sentence.',
  'Who proved Fermat’s Last Theorem, and in what year? One sentence.',
  'What is the chemical symbol for Tungsten? One short sentence.',
  'Which company developed the Rust programming language? One sentence.',
  'Name the inventor of the World Wide Web. One sentence.',
  'What is the SI unit of electric resistance? One sentence.',
];

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface Sample {
  index: number;
  task: string;
  elapsedMs: number;
  rounds: number;
  score: number;
  accepted: boolean;
  outputPreview: string;
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

async function main(): Promise<void> {
  const ROUTER_URL = required('COMPUTE_ROUTER_BASE_URL');
  const ROUTER_KEY = required('COMPUTE_ROUTER_API_KEY');
  const MODEL = process.env.COMPUTE_MODEL ?? 'qwen/qwen-2.5-7b-instruct';

  const makeInference = () =>
    sealed0GInference({ model: MODEL, apiKey: ROUTER_KEY, baseUrl: ROUTER_URL, verifiable: true });

  const meshId = `throughput-bench-${Date.now().toString(36)}`;
  const mesh = new Mesh({ meshId, provider: InMemory({ namespace: `${meshId}-bus` }) });
  const planner = new Agent({
    role: 'planner',
    systemPrompt:
      'You decompose short factual questions into a numbered plan. Do NOT answer. Keep it terse.',
    inference: makeInference(),
  });
  const executor = new Agent({
    role: 'executor',
    systemPrompt:
      'You are a careful researcher. Follow the plan and produce a concise factual answer. One sentence per field when asked.',
    inference: makeInference(),
  });
  const critic = new Agent({
    role: 'critic',
    systemPrompt:
      'You are a strict academic reviewer. Grade the executor answer on factual accuracy. Output a single JSON object only: { "score": <0..1>, "accept": <bool>, "reason": "..." }',
    inference: makeInference(),
  });
  mesh.register(planner).register(executor).register(critic);

  console.log(
    `mesh-throughput benchmark: N=${N} model=${MODEL} maxRounds=${MAX_ROUNDS} taskDelay=${TASK_DELAY_MS}ms`,
  );
  const samples: Sample[] = [];
  const runStart = Date.now();
  for (let i = 0; i < N; i++) {
    if (i > 0 && TASK_DELAY_MS > 0) {
      console.log(`  ...sleeping ${TASK_DELAY_MS}ms to respect router rate limits`);
      await new Promise((r) => setTimeout(r, TASK_DELAY_MS));
    }
    const task = TASKS[i % TASKS.length]!;
    const t0 = Date.now();
    try {
      const result = await planExecuteCritique({
        mesh,
        planner,
        executors: [executor],
        critic,
        task,
        maxRounds: MAX_ROUNDS,
        acceptThreshold: ACCEPT_THRESHOLD,
      });
      const elapsedMs = Date.now() - t0;
      const accepted = result.score >= ACCEPT_THRESHOLD;
      samples.push({
        index: i,
        task,
        elapsedMs,
        rounds: result.rounds,
        score: result.score,
        accepted,
        outputPreview: result.finalOutput.slice(0, 80),
      });
      console.log(
        `  #${i}  ${elapsedMs.toString().padStart(6)}ms  rounds=${result.rounds} score=${result.score.toFixed(2)} accept=${accepted ? 'yes' : 'NO'}  "${result.finalOutput.slice(0, 60)}"`,
      );
    } catch (err) {
      // MaxRoundsExceededError = ran the full loop but critic never hit
      // threshold. Still a valid throughput sample: we did the work.
      if (!(err instanceof MaxRoundsExceededError)) throw err;
      const elapsedMs = Date.now() - t0;
      samples.push({
        index: i,
        task,
        elapsedMs,
        rounds: MAX_ROUNDS,
        score: 0,
        accepted: false,
        outputPreview: '(max rounds exceeded)',
      });
      console.log(
        `  #${i}  ${elapsedMs.toString().padStart(6)}ms  rounds=${MAX_ROUNDS} score=?    accept=NO   (max rounds exceeded — still counted)`,
      );
    }
  }
  const totalMs = Date.now() - runStart;

  await Promise.all([planner.close(), executor.close(), critic.close()]);
  await mesh.close();

  const medMs = median(samples.map((s) => s.elapsedMs));
  const totalSleepMs = Math.max(0, (samples.length - 1) * TASK_DELAY_MS);
  const activeMs = totalMs - totalSleepMs;
  const tasksPerSecRaw = samples.length / (totalMs / 1000);
  const tasksPerSecEffective = activeMs > 0 ? samples.length / (activeMs / 1000) : 0;
  const target = 0.5;

  console.log();
  console.log(
    `  total wall:            ${totalMs}ms (${(totalMs / 1000).toFixed(1)}s) for ${N} tasks`,
  );
  console.log(`  inter-task sleep:      ${totalSleepMs}ms`);
  console.log(`  active wall:           ${activeMs}ms`);
  console.log(`  per-task median:       ${medMs}ms`);
  console.log(`  throughput (raw):      ${tasksPerSecRaw.toFixed(3)} tasks/s`);
  console.log(
    `  throughput (effective):${tasksPerSecEffective.toFixed(3)} tasks/s  (target >${target})  ${tasksPerSecEffective > target ? 'yes' : 'NO'}`,
  );
  console.log();

  const report = {
    version: 1,
    benchmark: 'mesh-throughput',
    capturedAt: new Date().toISOString(),
    node: process.version,
    model: MODEL,
    maxRounds: MAX_ROUNDS,
    acceptThreshold: ACCEPT_THRESHOLD,
    samples,
    summary: {
      n: samples.length,
      totalMs,
      totalSleepMs,
      activeMs,
      perTaskMedianMs: medMs,
      tasksPerSecondRaw: tasksPerSecRaw,
      tasksPerSecondEffective: tasksPerSecEffective,
      target,
      ok: tasksPerSecEffective > target,
      meshBusStorage: 'InMemory (coordination-only; sealed0GInference hits real router)',
      note: 'Raw throughput reflects the free-testnet router rate limit. Effective throughput excludes inter-task sleeps.',
    },
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`report written to ${reportPath}`);
}

main().catch((err) => {
  console.error('mesh-throughput benchmark FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
