import { defineConfig } from 'vitest/config';
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

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
