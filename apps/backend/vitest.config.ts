import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    exclude: ['test/integration/**', 'node_modules/**'],
    environment: 'node',
    testTimeout: 10_000,
  },
});
