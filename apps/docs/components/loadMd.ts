/**
 * Server-side markdown loader for `output: 'export'`.
 *
 * Reads from `apps/docs/content/synced/<repo-relative-path>`, populated
 * by `pnpm sync-content` (runs as the `prebuild` hook). The loader does
 * not walk up to the repo root because Vercel ships only `apps/docs/`
 * and its node_modules; everything else has to live inside the docs app.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a path relative to the repo root and load it from the
 * pre-synced `apps/docs/content/synced/` mirror. Caller paths match
 * the source repo layout (`docs/architecture.md`,
 * `packages/core/README.md`, …) so call sites stay readable.
 */
export function loadDocMd(repoRelativePath: string): string {
  const path = resolve(here, '..', 'content', 'synced', repoRelativePath);
  return readFileSync(path, 'utf8');
}
