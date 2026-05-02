/**
 * Cold-start benchmark — Phase 4 §14.6 deliverable.
 *
 * Reproducibly times the clone → first-run path the quickstart prescribes:
 *
 *   1. pnpm install                              (node_modules)
 *   2. forge install + forge build               (solidity deps + ABIs)
 *   3. pnpm --filter core/memory/inft build      (workspace bundles)
 *   4. examples/research-claw pnpm dev           (end-to-end run on testnet)
 *
 * Per-step wall time is logged and a structured JSON report is written to
 * scripts/.benchmarks/cold-start.json so CI can diff it on PRs.
 *
 * Usage:
 *   pnpm benchmark:cold-start              # time the sequence in-place
 *   pnpm benchmark:cold-start --clean      # `pnpm clean` first (true cold)
 *   pnpm benchmark:cold-start --skip-run   # skip the live-testnet final step
 *
 * The --skip-run flag is for CI smoke runs that should not spend faucet
 * funds. The <10 min DX target in §16 requires the full sequence; use the
 * unflagged form when you want to publish a number.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const reportDir = resolve(here, '.benchmarks');
const reportPath = resolve(reportDir, 'cold-start.json');

const args = new Set(process.argv.slice(2));
const wantClean = args.has('--clean');
const skipRun = args.has('--skip-run');

interface StepResult {
  name: string;
  command: string;
  cwd: string;
  elapsedMs: number;
  exitCode: number;
  skipped?: boolean;
  skipReason?: string;
}

function ms(): number {
  return Number(process.hrtime.bigint() / 1_000_000n);
}

function runStep(
  name: string,
  command: string,
  cwd: string,
  options: { skip?: boolean; skipReason?: string } = {},
): StepResult {
  if (options.skip) {
    console.log(`SKIP [${name}] — ${options.skipReason ?? 'not needed'}`);
    return {
      name,
      command,
      cwd,
      elapsedMs: 0,
      exitCode: 0,
      skipped: true,
      skipReason: options.skipReason,
    };
  }
  console.log(`\n>>> [${name}] ${command}   (cwd=${cwd})`);
  const start = ms();
  const res = spawnSync('bash', ['-lc', command], {
    cwd,
    stdio: 'inherit',
    env: { ...process.env },
  });
  const elapsedMs = ms() - start;
  const exitCode = res.status ?? (res.error ? 1 : 0);
  console.log(`<<< [${name}] elapsed=${(elapsedMs / 1000).toFixed(1)}s exit=${exitCode}`);
  return { name, command, cwd, elapsedMs, exitCode };
}

function formatHms(totalMs: number): string {
  const totalSec = Math.round(totalMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

async function main(): Promise<void> {
  console.log('SovereignClaw cold-start benchmark');
  console.log(`repo: ${repoRoot}`);
  console.log(`flags: clean=${wantClean} skipRun=${skipRun}`);

  const steps: StepResult[] = [];

  if (wantClean) {
    steps.push(runStep('clean', 'pnpm clean', repoRoot));
  }

  steps.push(runStep('pnpm-install', 'pnpm install', repoRoot));

  const forgeLibsPresent =
    existsSync(resolve(repoRoot, 'contracts/lib/forge-std')) &&
    existsSync(resolve(repoRoot, 'contracts/lib/openzeppelin-contracts'));
  steps.push(
    runStep(
      'forge-install',
      'cd contracts && forge install foundry-rs/forge-std --no-git && forge install OpenZeppelin/openzeppelin-contracts --no-git',
      repoRoot,
      {
        skip: forgeLibsPresent,
        skipReason: 'contracts/lib deps already present',
      },
    ),
  );

  steps.push(runStep('forge-build', 'cd contracts && forge build', repoRoot));

  steps.push(
    runStep(
      'pkg-build',
      'pnpm --filter @sovereignclaw/core --filter @sovereignclaw/memory --filter @sovereignclaw/inft build',
      repoRoot,
    ),
  );

  steps.push(
    runStep(
      'research-claw-run',
      'pnpm --filter @sovereignclaw/example-research-claw dev',
      repoRoot,
      {
        skip: skipRun,
        skipReason: '--skip-run passed (no live testnet call)',
      },
    ),
  );

  const totalMs = steps.reduce((sum, s) => sum + s.elapsedMs, 0);
  const firstFail = steps.find((s) => s.exitCode !== 0 && !s.skipped);

  console.log('\n================ Summary ================');
  for (const s of steps) {
    const mark = s.skipped ? 'skip' : s.exitCode === 0 ? ' ok ' : 'FAIL';
    const time = s.skipped ? '   -  ' : `${(s.elapsedMs / 1000).toFixed(1).padStart(6)}s`;
    console.log(`  [${mark}] ${s.name.padEnd(22)} ${time}`);
  }
  console.log(`  ---------------------------------------`);
  console.log(`  total wall time           ${formatHms(totalMs)}  (${(totalMs / 1000).toFixed(1)}s)`);
  console.log('=========================================\n');

  const report = {
    version: 1,
    benchmark: 'cold-start',
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    flags: { clean: wantClean, skipRun },
    steps,
    totalMs,
    totalHms: formatHms(totalMs),
    ok: !firstFail,
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`report written to ${reportPath}`);

  if (firstFail) {
    console.error(`benchmark: step '${firstFail.name}' failed with exit ${firstFail.exitCode}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('benchmark: unexpected error');
  console.error(err);
  process.exit(1);
});
