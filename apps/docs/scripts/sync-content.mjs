// Copy source markdown into apps/docs/content/synced so the docs app is
// self-contained. Vercel only ships `apps/docs/` and its node_modules to
// the build sandbox — the rest of the monorepo (docs/<name>.md and
// packages/<name>/README.md) is not present. Running this script before
// `next build` mirrors the markdown into a known location inside the
// docs app so `loadMd.ts` can resolve it via a relative path with no
// walk-up tricks.
//
// Idempotent. Safe to re-run. Cleared by `pnpm clean`.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// `apps/docs/scripts/` → `apps/docs/` → `apps/` → repo root.
const repoRoot = resolve(here, '..', '..', '..');
const out = resolve(here, '..', 'content', 'synced');

const SOURCES = [
  'docs/architecture.md',
  'docs/benchmarks.md',
  'docs/quickstart.md',
  'docs/security.md',
  'docs/streaming.md',
  'packages/core/README.md',
  'packages/memory/README.md',
  'packages/mesh/README.md',
  'packages/inft/README.md',
  'packages/reflection/README.md',
];

mkdirSync(out, { recursive: true });

let copied = 0;
let missing = 0;
for (const src of SOURCES) {
  const from = resolve(repoRoot, src);
  if (!existsSync(from)) {
    console.warn(`sync-content: WARN missing source ${src}`);
    missing += 1;
    continue;
  }
  const target = resolve(out, src);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(from, target);
  copied += 1;
}

// Build a small manifest the loader can use to verify presence.
const manifest = {
  generatedAt: new Date().toISOString(),
  sources: SOURCES,
  copied,
  missing,
};
writeFileSync(resolve(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`sync-content: copied ${copied} file(s) into apps/docs/content/synced/`);
if (missing > 0) {
  console.warn(`sync-content: ${missing} source file(s) missing`);
  process.exitCode = 1;
}
