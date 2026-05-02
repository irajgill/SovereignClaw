/**
 * Phase 0 chain smoke: deploy Ping.sol via ethers using the Foundry-built
 * artifact, call ping(), wait for the receipt, and verify the Pinged event.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import type { Env } from './env.js';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ChainSmokeResult {
  contractAddress: string;
  deployTxHash: string;
  pingTxHash: string;
  blockNumber: number;
  gasUsed: string;
  explorerUrls: { contract: string; deployTx: string; pingTx: string };
}

interface FoundryArtifact {
  abi: ethers.InterfaceAbi;
  bytecode: { object: string };
}

export async function smokeChain(env: Env, signer: ethers.Wallet): Promise<ChainSmokeResult> {
  const artifactPath = resolve(__dirname, '..', '..', 'contracts', 'out', 'Ping.sol', 'Ping.json');
  let artifact: FoundryArtifact;
  try {
    artifact = JSON.parse(readFileSync(artifactPath, 'utf8')) as FoundryArtifact;
  } catch (err) {
    throw new Error(
      `chain: could not read Foundry artifact at ${artifactPath}. ` +
        `Did you run \`pnpm contracts:build\` first? Underlying: ${(err as Error).message}`,
    );
  }

  logger.info('chain: deploying Ping.sol');
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, signer);
  const contract = await factory.deploy();
  const deployTx = contract.deploymentTransaction();
  if (!deployTx) throw new Error('chain: no deployment tx returned');
  await contract.waitForDeployment();
  const contractAddress = await contract.getAddress();
  logger.info({ contractAddress, deployTxHash: deployTx.hash }, 'chain: deployed');

  const pingFn = contract.getFunction('ping');
  const tx = await pingFn('hello-from-smoke');
  const receipt = await tx.wait();
  if (!receipt) throw new Error('chain: ping receipt missing');

  const pingedTopic = ethers.id('Pinged(address,string,uint256)');
  const matched = receipt.logs.some((log: ethers.Log) => log.topics[0] === pingedTopic);
  if (!matched) throw new Error('chain: Pinged event not found in receipt');

  logger.info(
    { pingTxHash: receipt.hash, gasUsed: receipt.gasUsed.toString() },
    'chain: ping ok with verified event',
  );

  return {
    contractAddress,
    deployTxHash: deployTx.hash,
    pingTxHash: receipt.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    explorerUrls: {
      contract: `${env.EXPLORER_URL}/address/${contractAddress}`,
      deployTx: `${env.EXPLORER_URL}/tx/${deployTx.hash}`,
      pingTx: `${env.EXPLORER_URL}/tx/${receipt.hash}`,
    },
  };
}
