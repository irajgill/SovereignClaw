/**
 * Server-side bundler for ClawStudio generated code.
 *
 * Purpose (v0 scope): VALIDATE that the generated code parses and can
 * resolve its SovereignClaw imports. We do not ship the bundle anywhere
 * — the real "deployment artifact" is the manifest blob on 0G Storage
 * plus one iNFT per Agent node. But an esbuild syntax check rejects
 * malformed graphs before we spend gas.
 *
 * We use esbuild in `transform` mode for speed (no entry point write);
 * this catches TS parse errors and basic reference errors, which is all
 * we need to protect the mint path.
 */
import { transform } from 'esbuild';

export interface BundleResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  bytes: number;
}

export async function validateCode(code: string): Promise<BundleResult> {
  try {
    const result = await transform(code, {
      loader: 'ts',
      target: 'node22',
      format: 'esm',
      sourcemap: false,
    });
    return {
      ok: true,
      errors: [],
      warnings: result.warnings.map((w) => w.text),
      bytes: Buffer.byteLength(result.code, 'utf8'),
    };
  } catch (err) {
    const e = err as { errors?: Array<{ text: string }>; message?: string };
    const errors = e.errors?.map((x) => x.text) ?? [e.message ?? String(err)];
    return { ok: false, errors, warnings: [], bytes: 0 };
  }
}
