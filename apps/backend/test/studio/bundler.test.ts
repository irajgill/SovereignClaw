import { describe, expect, it } from 'vitest';
import { validateCode } from '../../src/studio/bundler.js';

describe('validateCode (esbuild transform)', () => {
  it('accepts a valid TypeScript program', async () => {
    const r = await validateCode(`
      const x: number = 1;
      async function main(): Promise<void> { console.log(x); }
      main();
    `);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.bytes).toBeGreaterThan(0);
  });

  it('rejects syntactically broken code', async () => {
    const r = await validateCode(`const x: = 1`);
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('accepts ESM import syntax', async () => {
    const r = await validateCode(`
      import { foo } from 'nowhere';
      export const bar = foo;
    `);
    expect(r.ok).toBe(true);
  });
});
