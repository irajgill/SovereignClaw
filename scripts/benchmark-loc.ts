/**
 * LoC benchmark — §16 deliverable.
 *
 * Counts non-blank, non-comment lines in SovereignClaw example agents
 * and in the Studio-generated source for the seed 3-agent graph. The
 * methodology is intentionally boring and honest:
 *
 *   - Reads a file verbatim from disk (or computes it for the Studio case).
 *   - Strips block comments `/* ... *\/` spanning one or more lines.
 *   - Strips trailing `//` line comments.
 *   - Drops lines that are blank after strip.
 *
 * We publish BOTH `rawLoc` and `effectiveLoc` per file so readers can
 * verify how much of the file is scaffolding (env loading, logging,
 * cleanup) vs. actual SovereignClaw API calls. The §16 targets quote
 * `effectiveLoc`; the gap to `rawLoc` is real and documented.
 *
 * Output: `scripts/.benchmarks/loc.json` plus a console table.
 *
 * Usage:
 *   pnpm benchmark:loc               # write JSON report + print table
 *   pnpm benchmark:loc --check       # exit 1 if any target exceeded
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateCode } from '../packages/studio/lib/codegen.js';
import { seedGraph } from '../packages/studio/lib/seed-graph.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const reportDir = resolve(here, '.benchmarks');
const reportPath = resolve(reportDir, 'loc.json');

const args = new Set(process.argv.slice(2));
const wantCheck = args.has('--check');

/**
 * Count non-blank, non-comment lines. We strip block comments first
 * (cheap regex; safe because our examples are not obfuscated TS) and
 * then trailing `//` comments line-by-line.
 */
function effectiveLoc(src: string): number {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '');
  let count = 0;
  for (const rawLine of noBlock.split('\n')) {
    const line = rawLine.replace(/\/\/.*$/, '').trim();
    if (line.length === 0) continue;
    count += 1;
  }
  return count;
}

interface Sample {
  name: string;
  source: string;
  rawLoc: number;
  effectiveLoc: number;
  target?: number;
  note?: string;
}

function sampleFromFile(name: string, relPath: string, target?: number, note?: string): Sample {
  const abs = resolve(repoRoot, relPath);
  const src = readFileSync(abs, 'utf8');
  return {
    name,
    source: relPath,
    rawLoc: src.split('\n').length,
    effectiveLoc: effectiveLoc(src),
    target,
    note,
  };
}

function sampleFromString(name: string, src: string, target?: number, note?: string): Sample {
  return {
    name,
    source: '(generated)',
    rawLoc: src.split('\n').length,
    effectiveLoc: effectiveLoc(src),
    target,
    note,
  };
}

/**
 * Minimal reference snippets — the smallest code a user has to write
 * to get a sovereign agent / 3-agent mesh running. These are what
 * §16 targets are measured against (API surface, not example scaffolding).
 *
 * We keep them as inline strings instead of committed example files so
 * this script is the single source of truth and they're compared to
 * the full hand-written examples in the same report.
 */
const MINIMAL_SINGLE_AGENT = `
import { JsonRpcProvider, Wallet } from 'ethers';
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { OG_Log, encrypted, deriveKekFromSigner } from '@sovereignclaw/memory';

const provider = new JsonRpcProvider(process.env.RPC_URL!);
const signer = new Wallet(process.env.PRIVATE_KEY!, provider);
const kek = await deriveKekFromSigner(signer, 'my-agent');
const memory = encrypted(
  OG_Log({ namespace: 'my-agent', rpcUrl: process.env.RPC_URL!, indexerUrl: process.env.INDEXER_URL!, signer }),
  { kek },
);
const agent = new Agent({
  role: 'researcher',
  systemPrompt: 'You are a careful researcher.',
  inference: sealed0GInference({
    model: 'qwen/qwen-2.5-7b-instruct',
    apiKey: process.env.COMPUTE_ROUTER_API_KEY!,
    baseUrl: process.env.COMPUTE_ROUTER_BASE_URL!,
    verifiable: true,
  }),
  memory,
});
const out = await agent.run('What year was the Transformer paper published?');
console.log(out?.text);
await agent.close();
`.trim();

const MINIMAL_THREE_AGENT_MESH = `
import { JsonRpcProvider, Wallet } from 'ethers';
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { InMemory } from '@sovereignclaw/memory';
import { Mesh, planExecuteCritique } from '@sovereignclaw/mesh';

const inference = () => sealed0GInference({
  model: 'qwen/qwen-2.5-7b-instruct',
  apiKey: process.env.COMPUTE_ROUTER_API_KEY!,
  baseUrl: process.env.COMPUTE_ROUTER_BASE_URL!,
  verifiable: true,
});
const planner = new Agent({ role: 'planner', systemPrompt: 'You plan.', inference: inference() });
const executor = new Agent({ role: 'executor', systemPrompt: 'You execute.', inference: inference() });
const critic = new Agent({ role: 'critic', systemPrompt: 'You grade JSON only.', inference: inference() });
const mesh = new Mesh({ meshId: 'my-mesh', provider: InMemory({ namespace: 'my-mesh-bus' }) });
mesh.register(planner).register(executor).register(critic);
const result = await planExecuteCritique({
  mesh,
  planner,
  executors: [executor],
  critic,
  task: 'Name the Transformer authors and venue. One sentence each.',
  maxRounds: 2,
  acceptThreshold: 0.7,
});
console.log(result.finalOutput, 'score:', result.score);
await Promise.all([planner.close(), executor.close(), critic.close()]);
await mesh.close();
`.trim();

const samples: Sample[] = [
  sampleFromString(
    'minimal-single-agent (API surface only)',
    MINIMAL_SINGLE_AGENT,
    30,
    'the smallest sovereign agent: deps + memory + inference + run + close',
  ),
  sampleFromString(
    'minimal-3-agent-mesh (API surface only)',
    MINIMAL_THREE_AGENT_MESH,
    60,
    'the smallest planExecuteCritique mesh: 3 agents + mesh + run + close',
  ),
  sampleFromFile(
    'research-claw (hand-written example, includes scaffolding)',
    'examples/research-claw/src/index.ts',
    undefined,
    'reference example: env loading, event logging, iNFT mint, cleanup',
  ),
  sampleFromFile(
    'research-mesh (hand-written example, includes scaffolding)',
    'examples/research-mesh/src/index.ts',
    undefined,
    'reference example: bus event logging + replay check',
  ),
  sampleFromFile(
    'agent-mint-transfer-revoke (Phase 3 DoD)',
    'examples/agent-mint-transfer-revoke/src/index.ts',
    undefined,
    'full mint → transfer-with-reencryption → revoke lifecycle',
  ),
  sampleFromString(
    'Studio-generated (3-agent research swarm)',
    generateCode(seedGraph()).source,
    undefined,
    'pure function output; includes dotenv + env helper scaffolding',
  ),
];

function table(ss: Sample[]): string {
  const header = ['name', 'raw', 'effective', 'target', 'ok?'];
  const rows = ss.map((s) => [
    s.name,
    s.rawLoc.toString(),
    s.effectiveLoc.toString(),
    s.target?.toString() ?? '-',
    s.target === undefined ? '-' : s.effectiveLoc <= s.target ? 'yes' : 'NO',
  ]);
  const all = [header, ...rows];
  const widths = header.map((_, col) => Math.max(...all.map((r) => r[col]!.length)));
  return all
    .map(
      (r, i) =>
        '  ' +
        r.map((cell, col) => cell.padEnd(widths[col]!)).join('  ') +
        (i === 0 ? '\n  ' + widths.map((w) => '-'.repeat(w)).join('  ') : ''),
    )
    .join('\n');
}

function main(): void {
  console.log('SovereignClaw LoC benchmark');
  console.log(table(samples));
  console.log();

  const report = {
    version: 1,
    benchmark: 'loc',
    capturedAt: new Date().toISOString(),
    node: process.version,
    samples,
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`report written to ${reportPath}`);

  const failures = samples.filter((s) => s.target !== undefined && s.effectiveLoc > s.target);
  if (wantCheck && failures.length > 0) {
    console.error(`\nbenchmark: ${failures.length} sample(s) exceed §16 target:`);
    for (const s of failures) {
      console.error(`  - ${s.name}: ${s.effectiveLoc} > ${s.target}`);
    }
    process.exit(1);
  }
}

main();
