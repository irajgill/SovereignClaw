/**
 * Phase 0 smoke test - proves the three rails work against real 0G Galileo
 * testnet:
 *   1. Storage: write 1 KB to 0G Log via turbo indexer, read back, verify.
 *   2. Compute: call 0G Compute Router with chosen model, get a reply.
 *   3. Chain: deploy Ping.sol, call ping(), verify Pinged event in receipt.
 *
 * No mocks. Every step produces a verifiable artifact.
 *
 * CLI surface:
 *   pnpm smoke           - run all three
 *   pnpm smoke storage   - storage only
 *   pnpm smoke compute   - compute only
 *   pnpm smoke chain     - chain only (requires `pnpm contracts:build` first)
 */
import { ethers } from 'ethers';
import { smokeChain } from './lib/chain.js';
import { smokeCompute } from './lib/compute.js';
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';
import { smokeStorage } from './lib/storage.js';

type Step = 'storage' | 'compute' | 'chain' | 'all';

function parseStep(argv: string[]): Step {
  const arg = argv[2];
  if (!arg) return 'all';
  if (arg === 'storage' || arg === 'compute' || arg === 'chain') return arg;
  throw new Error(`Unknown step: ${arg}. Use one of: storage | compute | chain`);
}

async function main() {
  const step = parseStep(process.argv);
  const env = loadEnv();
  const provider = new ethers.JsonRpcProvider(env.RPC_URL);
  const signer = new ethers.Wallet(env.PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  if (Number(network.chainId) !== env.CHAIN_ID) {
    throw new Error(`chain id mismatch - RPC says ${network.chainId}, env says ${env.CHAIN_ID}`);
  }
  const balance = await provider.getBalance(signer.address);
  logger.info(
    { address: signer.address, chainId: env.CHAIN_ID, balanceWei: balance.toString() },
    'wallet: ready',
  );
  if (balance === 0n) {
    throw new Error(
      `wallet ${signer.address} has zero balance. Fund it from https://faucet.0g.ai.`,
    );
  }

  const results: Record<string, unknown> = {};

  if (step === 'all' || step === 'storage') {
    results.storage = await smokeStorage(env, signer);
  }
  if (step === 'all' || step === 'compute') {
    results.compute = await smokeCompute(env);
  }
  if (step === 'all' || step === 'chain') {
    results.chain = await smokeChain(env, signer);
  }

  console.log('\n=== SovereignClaw Phase 0 Smoke - PASSED ===');
  if (results.storage) {
    const r = results.storage as Awaited<ReturnType<typeof smokeStorage>>;
    console.log(`  Storage rootHash : ${r.rootHash}`);
    console.log(`           txHash   : ${r.txHash}`);
    console.log(`           latency  : upload=${r.uploadMs}ms download=${r.downloadMs}ms`);
    console.log(`           explorer : ${env.STORAGE_EXPLORER_URL}/tx/${r.txHash}`);
  }
  if (results.compute) {
    const r = results.compute as Awaited<ReturnType<typeof smokeCompute>>;
    const teeStr =
      r.teeVerified === true
        ? 'true ✓'
        : r.teeVerified === false
          ? 'false ✗'
          : 'unknown (field absent)';
    console.log(`  Compute model    : ${r.model}`);
    console.log(`           tee_ver  : ${teeStr}`);
    console.log(`           latency  : ${r.latencyMs}ms`);
    console.log(`           reply    : ${r.reply.slice(0, 120)}`);
  }
  if (results.chain) {
    const r = results.chain as Awaited<ReturnType<typeof smokeChain>>;
    console.log(`  Contract address : ${r.contractAddress}`);
    console.log(`           deploy   : ${r.explorerUrls.deployTx}`);
    console.log(`           ping     : ${r.explorerUrls.pingTx}`);
    console.log(`           gas used : ${r.gasUsed}`);
  }
  console.log();
}

main().catch((err) => {
  const detail =
    err instanceof Error ? { message: err.message, stack: err.stack } : { err: String(err) };
  logger.error(detail, 'smoke: FAILED');
  process.exit(1);
});
