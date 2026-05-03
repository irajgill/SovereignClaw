import { defineConfig } from 'tsup';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Externalize every runtime dependency. tsup's default bundles deps; for an
// app (not a library) we want a slim entry script that loads its deps from
// node_modules at runtime — `pnpm deploy` already produces that
// node_modules tree. Bundling things like `dotenv` (CJS) into ESM produced
// `Dynamic require of "fs" is not supported` at boot.
const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const externals = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
];

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node22',
  splitting: false,
  treeshake: true,
  external: externals,
});
