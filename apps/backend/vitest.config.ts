import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'test/studio/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
