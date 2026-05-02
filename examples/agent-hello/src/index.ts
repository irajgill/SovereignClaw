/**
 * agent-hello - Phase 1 Definition of Done example.
 *
 * Wires together every Phase 1 primitive against real 0G Galileo testnet:
 *   1. Loads a wallet, derives a KEK from its signature.
 *   2. Builds an encrypted OG_Log MemoryProvider for context state.
 *   3. Builds an Agent with a system prompt + that memory + the Router-backed
 *      sealed0GInference adapter (verify_tee=true).
 *   4. Calls agent.run('hello'), prints the output and attestation.
 *   5. Re-reads the persisted context to confirm the round-trip end-to-end.
 *
 * Cost per run: ~0.0005 0G total (one storage upload + a tiny inference call).
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { OG_Log, deriveKekFromSigner, encrypted } from '@sovereignclaw/memory';
import { ethers } from 'ethers';

// Auto-load the repo root .env if it exists, relative to this file's location
// rather than process.cwd, so the example works regardless of invocation path.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootEnv = resolve(__dirname, '../../..', '.env');
if (existsSync(rootEnv)) {
  loadDotenv({ path: rootEnv });
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

async function main(): Promise<void> {
  const RPC_URL = required('RPC_URL');
  const INDEXER_URL = required('INDEXER_URL');
  const PRIVATE_KEY = required('PRIVATE_KEY');
  const ROUTER_URL = required('COMPUTE_ROUTER_BASE_URL');
  const ROUTER_KEY = required('COMPUTE_ROUTER_API_KEY');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(PRIVATE_KEY, provider);

  const namespace = `agent-hello-${Date.now()}`;
  console.log(`agent-hello: namespace=${namespace}`);
  console.log(`agent-hello: wallet=${signer.address}`);

  const kek = await deriveKekFromSigner(signer, namespace);
  const memory = encrypted(
    OG_Log({ namespace, rpcUrl: RPC_URL, indexerUrl: INDEXER_URL, signer }),
    { kek },
  );

  const agent = new Agent({
    role: 'greeter',
    systemPrompt: 'You are a friendly assistant. Reply in one sentence.',
    inference: sealed0GInference({
      model: 'qwen/qwen-2.5-7b-instruct',
      apiKey: ROUTER_KEY,
      baseUrl: ROUTER_URL,
      verifiable: true,
    }),
    memory,
  });

  agent.on('run.start', ({ runId }) => console.log(`agent-hello: run ${runId} starting`));
  agent.on('run.complete', ({ runId, output }) => {
    console.log(`agent-hello: run ${runId} complete in ${output.latencyMs}ms`);
  });

  console.log('\nagent-hello: calling agent.run("hello")...');
  const result = await agent.run('hello');
  if (!result) throw new Error('agent returned null');

  console.log('\n=== Agent output ===');
  console.log(`  Reply           : ${result.text}`);
  console.log(`  Model           : ${result.model}`);
  console.log(`  TEE verified    : ${result.attestation.teeVerified}`);
  console.log(`  Provider        : ${result.attestation.providerAddress}`);
  console.log(`  Total cost (wei): ${result.billing.totalCost}`);
  console.log(`  Latency         : ${result.latencyMs}ms`);

  console.log('\nagent-hello: verifying encrypted state on 0G Log...');
  const storedContext = await memory.get('context');
  if (!storedContext) throw new Error('context not persisted');
  const parsed = JSON.parse(new TextDecoder().decode(storedContext));
  console.log(`  Stored ${parsed.recentMessages.length} messages`);
  console.log(
    `  Last message role: ${parsed.recentMessages[parsed.recentMessages.length - 1].role}`,
  );
  console.log(`  Updated at      : ${new Date(parsed.updatedAt).toISOString()}`);

  await agent.close();
  console.log('\nagent-hello: done.');
}

main().catch((err) => {
  console.error('\nagent-hello: FAILED');
  console.error(err);
  process.exit(1);
});
