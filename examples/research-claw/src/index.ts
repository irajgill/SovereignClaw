/**
 * ResearchClaw — Phase 4 Definition-of-Done example.
 *
 * Composes every Phase 1–3 primitive against real 0G Galileo testnet in
 * under 100 lines of agent wiring:
 *
 *   1. Wallet-derived KEK for a dedicated namespace (AES-256-GCM + HKDF).
 *   2. Encrypted OG_Log memory for `context`, encrypted OG_Log history
 *      for append-only run logs. Every byte on 0G is ciphertext.
 *   3. Agent (@sovereignclaw/core) with a researcher system prompt and the
 *      Router-backed `sealed0GInference` adapter (verify_tee=true).
 *   4. Runs the agent on an academic research question. Prints the TEE
 *      attestation, provider address, latency, and per-call billing.
 *   5. Writes an agent manifest to memory, captures its 0G root hash,
 *      and mints an ERC-7857 iNFT via `@sovereignclaw/inft`. Prints the
 *      chainscan-galileo URL.
 *
 * Reflection is deferred to Phase 6; see docs/dev-log.md Phase 6 DoD.
 *
 * Prereqs:
 *   - `.env` at repo root with PRIVATE_KEY, RPC_URL, INDEXER_URL,
 *     COMPUTE_ROUTER_BASE_URL, COMPUTE_ROUTER_API_KEY, COMPUTE_MODEL.
 *   - PRIVATE_KEY wallet funded on 0G Galileo (https://faucet.0g.ai).
 *   - Router account funded for the chosen model
 *     (https://pc.testnet.0g.ai).
 *   - `pnpm --filter @sovereignclaw/memory --filter @sovereignclaw/inft build`
 *     has been run at least once so workspace deps resolve.
 */
import { config as loadDotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

{
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '..', '.env'),
    resolve(here, '..', '..', '..', '.env'),
    resolve(process.cwd(), '.env'),
  ];
  for (const path of candidates) {
    if (existsSync(path)) {
      loadDotenv({ path });
      break;
    }
  }
}

import { JsonRpcProvider, Wallet, randomBytes } from 'ethers';
import { Agent, sealed0GInference } from '@sovereignclaw/core';
import { OG_Log, deriveKekFromSigner, encrypted } from '@sovereignclaw/memory';
import { loadDeployment, mintAgentNFT, type MintableAgent } from '@sovereignclaw/inft';

const KEK_NAMESPACE = process.env.KEK_NAMESPACE ?? 'research-claw-v1';
const DEFAULT_QUESTION =
  'Summarize the three most cited papers on retrieval-augmented generation from 2024. Cite authors and venue for each.';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing required env var ${name}`);
  return value;
}

function log(step: string, data: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ step, ...data }, null, 2));
}

async function main(): Promise<void> {
  const RPC_URL = required('RPC_URL');
  const INDEXER_URL = required('INDEXER_URL');
  const EXPLORER_URL = required('EXPLORER_URL');
  const PRIVATE_KEY = required('PRIVATE_KEY');
  const ROUTER_URL = required('COMPUTE_ROUTER_BASE_URL');
  const ROUTER_KEY = required('COMPUTE_ROUTER_API_KEY');
  const MODEL = process.env.COMPUTE_MODEL ?? 'qwen/qwen-2.5-7b-instruct';
  const question = process.argv.slice(2).join(' ').trim() || DEFAULT_QUESTION;

  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(PRIVATE_KEY, provider);
  const deployment = loadDeployment();

  log('start', {
    owner: signer.address,
    chainId: deployment.chainId,
    AgentNFT: deployment.addresses.AgentNFT,
    model: MODEL,
    namespace: KEK_NAMESPACE,
  });

  const kek = await deriveKekFromSigner(signer, KEK_NAMESPACE);
  const memory = encrypted(
    OG_Log({ namespace: `${KEK_NAMESPACE}-state`, rpcUrl: RPC_URL, indexerUrl: INDEXER_URL, signer }),
    { kek },
  );
  const history = encrypted(
    OG_Log({ namespace: `${KEK_NAMESPACE}-log`, rpcUrl: RPC_URL, indexerUrl: INDEXER_URL, signer }),
    { kek },
  );

  const research = new Agent({
    role: 'researcher',
    systemPrompt:
      'You are a careful academic researcher. When asked about papers, cite authors, year, and venue. Prefer precision over breadth. If uncertain, say so.',
    inference: sealed0GInference({
      model: MODEL,
      apiKey: ROUTER_KEY,
      baseUrl: ROUTER_URL,
      verifiable: true,
    }),
    memory,
    history,
  });

  research.on('run.start', ({ runId }) => log('run.start', { runId }));
  research.on('run.complete', ({ runId, output }) =>
    log('run.complete', {
      runId,
      latencyMs: output.latencyMs,
      teeVerified: output.attestation.teeVerified,
      providerAddress: output.attestation.providerAddress,
      totalCostWei: output.billing.totalCost.toString(),
    }),
  );

  log('run.input', { question });
  const out = await research.run(question);
  if (!out) throw new Error('research: agent returned null');

  console.log('\n=== ResearchClaw output ===');
  console.log(out.text);
  console.log('===========================\n');

  // Write an agent manifest to memory so we have a stable, mintable pointer.
  // The context key already holds the latest messages (Agent writes it), but
  // we want an explicit manifest the iNFT metadata commits to.
  const manifestBytes = new TextEncoder().encode(
    JSON.stringify({
      v: 1,
      role: research.role,
      namespace: KEK_NAMESPACE,
      mintedAt: Date.now(),
      lastRun: {
        question,
        model: out.model,
        latencyMs: out.latencyMs,
        teeVerified: out.attestation.teeVerified,
      },
    }),
  );
  const { pointer } = await memory.set('manifest', manifestBytes);
  await research.flush();
  log('manifest', { pointer });

  const mintable: MintableAgent = {
    role: research.role,
    getPointer: () => pointer,
  };

  const minted = await mintAgentNFT({
    agent: mintable,
    owner: signer,
    royaltyBps: 500,
    wrappedDEK: randomBytes(32),
    deployment,
    explorerBase: EXPLORER_URL,
  });
  log('mint', {
    tokenId: minted.tokenId.toString(),
    txHash: minted.txHash,
    explorerUrl: minted.explorerUrl,
    metadataHash: minted.metadataHash,
    encryptedPointer: minted.encryptedPointer,
  });

  await research.close();
  log('done', {
    summary: 'ResearchClaw ran, persisted encrypted memory on 0G, and minted the agent as an iNFT.',
    explorerUrl: minted.explorerUrl,
    tokenId: minted.tokenId.toString(),
  });
}

main().catch((err) => {
  console.error('\nresearch-claw: FAILED');
  console.error(err);
  process.exit(1);
});
