/**
 * ABI surface for the AgentNFT and MemoryRevocation contracts.
 *
 * Re-exports the foundry-built ABIs as plain JSON so consumers don't need to
 * resolve `contracts/out/...` paths at runtime. tsup bundles the JSON.
 *
 * If anyone changes the contract ABI, `pnpm contracts:build` rewrites
 * the JSON and tsup picks it up next build.
 */

import agentNftArtifact from '../../../contracts/out/AgentNFT.sol/AgentNFT.json' with { type: 'json' };

import revocationArtifact from '../../../contracts/out/MemoryRevocation.sol/MemoryRevocation.json' with { type: 'json' };

interface FoundryArtifact {
  abi: ReadonlyArray<unknown>;
}

export const AgentNFTAbi = (agentNftArtifact as FoundryArtifact).abi;
export const MemoryRevocationAbi = (revocationArtifact as FoundryArtifact).abi;

/**
 * Limits enforced by the Solidity contract. Mirrored here so TS can validate
 * before submitting a tx that would just revert. Numbers must match the
 * `MAX_*` constants in AgentNFT.sol.
 */
export const CONTRACT_LIMITS = {
  MAX_WRAPPED_DEK_BYTES: 2048,
  MAX_ROLE_BYTES: 64,
  MAX_ROYALTY_BPS: 10_000,
} as const;
