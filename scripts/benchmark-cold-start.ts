/**
 * Cold-start benchmark — Phase 4 §14.6 deliverable.
 *
 * Reproducibly times the clone → first-run path the quickstart prescribes:
 *
 *   1. pnpm install                              (node_modules)
 *   2. forge install + forge build               (solidity deps + ABIs)
 *   3. pnpm --filter core/memory/inft build      (workspace bundles)
 *   4. examples/research-claw pnpm dev           (end-to-end run on testnet)
 *   5. (optional) pnpm smoke:studio              (end-to-end Studio deploy)
 *
 * Per-step wall time is logged and a structured JSON report is written to
 * scripts/.benchmarks/cold-start.json so CI can diff it on PRs.
 *
 * Usage:
 *   pnpm benchmark:cold-start              # time the sequence in-place
 *   pnpm benchmark:cold-start --clean      # `pnpm clean` first (true cold)
 *   pnpm benchmark:cold-start --skip-run   # skip the live-testnet final step
 *   pnpm benchmark:cold-start --with-studio
 *                                          # also starts the backend, waits
 *                                          # for /healthz, then runs
 *                                          # pnpm smoke:studio (mints 3 iNFTs).
 *                                          # Phase 7 carryover → Phase 8.
 *
 * The --skip-run flag is for CI smoke runs that should not spend faucet
 * funds. The <10 min DX target in §16 requires the full sequence; use the
 * unflagged form when you want to publish a number.
 */
import { spawn, spawnSync } from 'node:child_process';
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
const wantStudio = args.has('--with-studio');

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

function spawnBackend(): number | null {
  console.log('\n>>> [studio] spawning @sovereignclaw/backend dev in background');
  try {
    const child = spawn('pnpm', ['--filter', '@sovereignclaw/backend', 'dev'], {
      cwd: repoRoot,
      env: { ...process.env, LOG_LEVEL: 'error' },
      stdio: ['ignore', 'ignore', 'ignore'],
      detached: false,
    });
    child.unref();
    if (!child.pid) return null;
    console.log(`<<< [studio] backend pid=${child.pid}`);
    return child.pid;
  } catch (err) {
    console.error('studio: failed to spawn backend', err);
    return null;
  }
}

interface WaitResult {
  ok: boolean;
  waitedMs: number;
}

function waitForStudio(timeoutMs: number): WaitResult {
  const start = ms();
  const url = `${process.env.ORACLE_URL ?? 'http://localhost:8787'}/healthz`;
  console.log(`>>> [studio] polling ${url} for studio.enabled=true (timeout ${timeoutMs}ms)`);
  while (ms() - start < timeoutMs) {
    const res = spawnSync('bash', ['-lc', `curl -sfm 2 ${url} | grep -q '"enabled":true'`], {
      stdio: 'ignore',
    });
    if (res.status === 0) {
      const waitedMs = ms() - start;
      console.log(`<<< [studio] backend ready in ${waitedMs}ms`);
      return { ok: true, waitedMs };
    }
    spawnSync('bash', ['-lc', 'sleep 0.5'], { stdio: 'ignore' });
  }
  console.error(`studio: backend did not become ready within ${timeoutMs}ms`);
  return { ok: false, waitedMs: ms() - start };
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
  console.log(`flags: clean=${wantClean} skipRun=${skipRun} withStudio=${wantStudio}`);

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

  // Optional Studio deploy step. Starts the backend as a background
  // process (SIGTERM on exit), waits for /healthz to report studio
  // enabled, then runs the smoke:studio script. Keeps this step opt-in
  // because it spends additional faucet gas (one manifest write + three
  // iNFT mints) compared to the research-claw step alone.
  if (wantStudio && !skipRun) {
    const backendPid = spawnBackend();
    try {
      const ready = waitForStudio(60_000);
      steps.push({
        name: 'studio-backend-ready',
        command: '(background) @sovereignclaw/backend dev + GET /healthz',
        cwd: repoRoot,
        elapsedMs: ready.waitedMs,
        exitCode: ready.ok ? 0 : 1,
      });
      if (ready.ok) {
        steps.push(runStep('studio-deploy', 'pnpm smoke:studio', repoRoot));
      }
    } finally {
      if (backendPid) {
        try {
          process.kill(backendPid, 'SIGTERM');
        } catch {
          /* already gone */
        }
      }
    }
  } else if (wantStudio && skipRun) {
    steps.push({
      name: 'studio-deploy',
      command: 'pnpm smoke:studio',
      cwd: repoRoot,
      elapsedMs: 0,
      exitCode: 0,
      skipped: true,
      skipReason: '--skip-run + --with-studio: skipped (no live testnet call)',
    });
  }

  const totalMs = steps.reduce((sum, s) => sum + s.elapsedMs, 0);
  const firstFail = steps.find((s) => s.exitCode !== 0 && !s.skipped);

  console.log('\n================ Summary ================');
  for (const s of steps) {
    const mark = s.skipped ? 'skip' : s.exitCode === 0 ? ' ok ' : 'FAIL';
    const time = s.skipped ? '   -  ' : `${(s.elapsedMs / 1000).toFixed(1).padStart(6)}s`;
    console.log(`  [${mark}] ${s.name.padEnd(22)} ${time}`);
  }
  console.log(`  ---------------------------------------`);
  console.log(
    `  total wall time           ${formatHms(totalMs)}  (${(totalMs / 1000).toFixed(1)}s)`,
  );
  console.log('=========================================\n');

  const report = {
    version: 1,
    benchmark: 'cold-start',
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    flags: { clean: wantClean, skipRun, withStudio: wantStudio },
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
