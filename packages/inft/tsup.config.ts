import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'node22',
  splitting: false,
  treeshake: true,
  // Ship the JSON ABIs and the typehash fixture inline so consumers don't
  // need access to contracts/out at install time.
  loader: { '.json': 'json' },
});
