import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

// Auto-load the repo root .env if it exists. In CI, env vars come from the
// workflow env block instead; loading is a no-op there because .env is ignored.
const rootEnv = resolve(__dirname, '../..', '.env');
if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv });
}

export default defineConfig({
  test: {
    include: ['test/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
