/**
 * Phase 0 storage smoke: write 1 KB to 0G Storage via the turbo indexer,
 * then download by root hash and verify byte equality.
 *
 * Uses MemData so we do not write a temp file. Uses the SDK's tuple-return
 * convention: [result, err]. The `signer as any` cast is required by the
 * SDK's lingering ethers v5 types vs our ethers v6. Runtime is fine, only
 * the TypeScript surface is mismatched.
 */
import { Indexer, MemData } from '@0gfoundation/0g-ts-sdk';
import { ethers } from 'ethers';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Env } from './env.js';
import { logger } from './logger.js';

export interface StorageSmokeResult {
  rootHash: string;
  txHash: string;
  uploadMs: number;
  downloadMs: number;
  bytesRoundTripped: number;
}

export async function smokeStorage(env: Env, signer: ethers.Wallet): Promise<StorageSmokeResult> {
  logger.info('storage: starting Log round-trip');
  const indexer = new Indexer(env.INDEXER_URL);

  const payload = new TextEncoder().encode(
    `sovereignclaw-smoke ts=${Date.now()} pad=${'x'.repeat(900)}`,
  );
  const memData = new MemData(payload);

  const [tree, treeErr] = await memData.merkleTree();
  if (treeErr !== null) throw new Error(`storage: merkleTree failed: ${treeErr}`);
  const expectedRoot = tree?.rootHash();
  if (!expectedRoot) throw new Error('storage: merkle tree returned no root');

  const uploadStart = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tx, uploadErr] = await indexer.upload(memData, env.RPC_URL, signer as any);
  if (uploadErr !== null) throw new Error(`storage: upload failed: ${uploadErr}`);
  const uploadMs = Date.now() - uploadStart;

  if (!('rootHash' in tx)) throw new Error('storage: unexpected fragmented response for 1KB');
  const { rootHash, txHash } = tx;
  if (rootHash !== expectedRoot) {
    throw new Error(`storage: root mismatch - local=${expectedRoot} indexer=${rootHash}`);
  }
  logger.info({ rootHash, txHash, uploadMs }, 'storage: upload ok');

  const tmpDir = mkdtempSync(join(tmpdir(), 'sclaw-smoke-'));
  const outPath = join(tmpDir, 'out.bin');
  const downloadStart = Date.now();
  const dlErr = await indexer.download(rootHash, outPath, true);
  if (dlErr !== null) throw new Error(`storage: download failed: ${dlErr}`);
  const downloadMs = Date.now() - downloadStart;

  const recovered = readFileSync(outPath);
  rmSync(tmpDir, { recursive: true, force: true });

  if (recovered.length !== payload.length) {
    throw new Error(`storage: length mismatch - wrote=${payload.length} read=${recovered.length}`);
  }
  for (let i = 0; i < payload.length; i += 1) {
    if (recovered[i] !== payload[i]) {
      throw new Error(`storage: byte mismatch at offset ${i}`);
    }
  }
  logger.info({ rootHash, downloadMs, bytes: payload.length }, 'storage: round-trip ok');

  return { rootHash, txHash, uploadMs, downloadMs, bytesRoundTripped: payload.length };
}
