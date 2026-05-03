/**
 * Revocation latency benchmark — §16 deliverable.
 *
 * Measures the "click-to-unreadable" latency of `@sovereignclaw/inft`'s
 * revoke flow against the real dev oracle + 0G Galileo testnet.
 *
 * Methodology:
 *   1. Mint a throwaway iNFT (pointer = synthetic keccak256 so we do NOT
 *      hit 0G Storage in the timed section). Mint is SETUP, excluded
 *      from the published number.
 *   2. `t0 = now()` — the "click" moment. Captured via the `onPhase`
 *      hook that `revokeMemory` (Phase 9) fires at each phase boundary:
 *      `started`, `signed`, `oracle-refused`, `chain-submitted`,
 *      `chain-confirmed`.
 *   3. Call `revokeMemory({...})` with `onPhase`.
 *      - `oracleRefuseMs`   = `oracle-refused - started`
 *      - `chainRevokeMs`    = `chain-confirmed - started`
 *   4. Call `oracle.reencrypt(...)`; expect `OracleRevokedError`.
 *      - `observedRefuseMs` = `t_now - started` (one extra RTT after
 *        chain-confirmed).
 *
 * We publish THREE numbers now that the oracle-side refuse moment is
 * directly observable:
 *   - `oracleRefuseMs`   — oracle-side unreadable (one HTTP RTT)
 *   - `chainRevokeMs`    — chain-durable unreadable (Galileo block time)
 *   - `observedRefuseMs` — client confirms the oracle 410 post-revoke
 *
 * Prereqs:
 *   - `apps/backend` running on $ORACLE_URL (default http://localhost:8787)
 *   - `PRIVATE_KEY` funded on 0G Galileo
 *   - `deployments/0g-testnet.json` present and the on-chain oracle
 *     rotated to the backend's key (else revoke reverts OracleMismatch)
 *
 * Output: `scripts/.benchmarks/revoke-latency.json` + console summary.
 *
 * Usage:
 *   pnpm benchmark:revoke-latency
 *   pnpm benchmark:revoke-latency --n 3      # 3 independent runs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JsonRpcProvider, Wallet, keccak256, randomBytes, toUtf8Bytes } from 'ethers';
import 'dotenv/config';
import {
  loadDeployment,
  mintAgentNFT,
  OracleClient,
  OracleRevokedError,
  revokeMemory,
} from '@sovereignclaw/inft';

const here = dirname(fileURLToPath(import.meta.url));
const reportDir = resolve(here, '.benchmarks');
const reportPath = resolve(reportDir, 'revoke-latency.json');

const argv = process.argv.slice(2);
function argValue(flag: string): string | undefined {
  const i = argv.indexOf(flag);
  if (i < 0) return undefined;
  return argv[i + 1];
}
const N = Number(argValue('--n') ?? 1);

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name}`);
  return v;
}

interface Sample {
  index: number;
  tokenId: string;
  mintMs: number;
  oracleRefuseMs: number;
  chainSubmitMs: number;
  chainRevokeMs: number;
  observedRefuseMs: number;
  signMs: number;
  mintTx: string;
  revokeTx: string;
}

async function runOne(
  index: number,
  signer: Wallet,
  oracle: OracleClient,
  deployment: ReturnType<typeof loadDeployment>,
): Promise<Sample> {
  // --- setup: mint a throwaway iNFT (not timed) -------------------------
  const syntheticPointer = keccak256(
    toUtf8Bytes(`revoke-benchmark-${index}-${Date.now()}-${Math.random()}`),
  );
  const agent = {
    role: `revoke-bench-${index}-${Date.now().toString(36)}`.slice(0, 32),
    getPointer: () => syntheticPointer,
  };
  const mintStart = Date.now();
  const minted = await mintAgentNFT({
    agent,
    owner: signer,
    wrappedDEK: randomBytes(32),
    deployment,
  });
  const mintMs = Date.now() - mintStart;
  console.log(
    `  run #${index}: minted tokenId=${minted.tokenId} in ${mintMs}ms (tx ${minted.txHash.slice(0, 10)}…)`,
  );

  // --- measured region --------------------------------------------------
  const revoked = await revokeMemory({
    tokenId: minted.tokenId,
    owner: signer,
    oracle,
    deployment,
    onPhase: (phase, atMs) => {
      // Live log per phase; useful when running without --verbose.
      console.log(`    [phase] ${phase.padEnd(18)} @${atMs}`);
    },
  });
  const t = revoked.timings;
  const signMs = t.signed - t.started;
  const oracleRefuseMs = t['oracle-refused'] - t.started;
  const chainSubmitMs = t['chain-submitted'] - t.started;
  const chainRevokeMs = t['chain-confirmed'] - t.started;
  console.log(
    `  run #${index}: sign=${signMs}ms oracle=${oracleRefuseMs}ms submit=${chainSubmitMs}ms chain=${chainRevokeMs}ms  ${revoked.explorerUrl}`,
  );

  const t0 = t.started;
  let observedRefuseMs: number;
  try {
    await oracle.reencrypt({
      tokenId: minted.tokenId.toString(),
      currentOwner: await signer.getAddress(),
      newOwner: '0x0000000000000000000000000000000000000001',
      newOwnerPubkey: signer.signingKey.publicKey,
    });
    throw new Error('oracle did not refuse post-revoke reencrypt (expected OracleRevokedError)');
  } catch (err) {
    if (!(err instanceof OracleRevokedError)) throw err;
    observedRefuseMs = Date.now() - t0;
  }

  return {
    index,
    tokenId: minted.tokenId.toString(),
    mintMs,
    signMs,
    oracleRefuseMs,
    chainSubmitMs,
    chainRevokeMs,
    observedRefuseMs,
    mintTx: minted.txHash,
    revokeTx: revoked.txHash,
  };
}

function median(vals: number[]): number {
  if (vals.length === 0) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? Math.round((s[mid - 1]! + s[mid]!) / 2) : s[mid]!;
}

async function main(): Promise<void> {
  const rpcUrl = required('RPC_URL');
  const privateKey = required('PRIVATE_KEY');
  const oracleUrl = process.env.ORACLE_URL ?? 'http://localhost:8787';
  const oracleAuthToken = process.env.ORACLE_AUTH_TOKEN || undefined;

  const provider = new JsonRpcProvider(rpcUrl);
  const signer = new Wallet(privateKey, provider);
  const deployment = loadDeployment();
  const oracle = new OracleClient({ url: oracleUrl, authToken: oracleAuthToken });

  const health = await oracle.healthz();
  if (!health.ok) throw new Error(`oracle healthz not ok: ${JSON.stringify(health)}`);
  console.log(
    `revoke-latency benchmark: signer=${signer.address} oracle=${health.oracleAddress} N=${N}`,
  );

  const samples: Sample[] = [];
  for (let i = 0; i < N; i++) {
    samples.push(await runOne(i, signer, oracle, deployment));
  }

  const oracleMedian = median(samples.map((s) => s.oracleRefuseMs));
  const chainMedian = median(samples.map((s) => s.chainRevokeMs));
  const observedMedian = median(samples.map((s) => s.observedRefuseMs));

  console.log();
  console.log(`  oracle-side refuse (median):  ${oracleMedian}ms`);
  console.log(`  chain-durable (median):       ${chainMedian}ms`);
  console.log(`  client-observed (median):     ${observedMedian}ms`);
  const targetMs = 5000;
  console.log(
    `  §16 target <${targetMs}ms:            oracle ${oracleMedian <= targetMs ? 'yes' : 'NO'}  chain ${chainMedian <= targetMs ? 'yes' : 'NO'}  observed ${observedMedian <= targetMs ? 'yes' : 'NO'}`,
  );
  console.log();

  const report = {
    version: 1,
    benchmark: 'revoke-latency',
    capturedAt: new Date().toISOString(),
    node: process.version,
    chainId: deployment.chainId,
    oracleUrl,
    targets: {
      oracleRefuseMs: targetMs,
      chainRevokeMs: targetMs,
      observedRefuseMs: targetMs,
    },
    samples,
    summary: {
      n: samples.length,
      oracleRefuseMedianMs: oracleMedian,
      chainRevokeMedianMs: chainMedian,
      observedRefuseMedianMs: observedMedian,
      oracleOk: oracleMedian <= targetMs,
      chainOk: chainMedian <= targetMs,
      observedOk: observedMedian <= targetMs,
    },
  };
  mkdirSync(reportDir, { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`report written to ${reportPath}`);
}

main().catch((err) => {
  console.error('revoke-latency benchmark FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
