/**
 * Browser wallet helper for ClawStudio. Thin wrapper around
 * `ethers.BrowserProvider` that:
 *
 *   - connects to window.ethereum (MetaMask / Rabby / etc.)
 *   - exposes the connected address + chainId
 *   - signs an EIP-712 typed-data blob over {graphSha, nonce, timestamp}
 *     which the Studio deploy route (Phase 9) verifies against
 *     `STUDIO_SIGNER_ALLOWLIST` before spending any gas.
 *
 * This is client-only; callers must only invoke `connect()` / `signDeploy()`
 * from a 'use client' React boundary. `isWalletAvailable()` is safe on the
 * server — it returns false.
 */
'use client';

import { BrowserProvider, getAddress, keccak256, toUtf8Bytes, type Eip1193Provider } from 'ethers';
import type { StudioGraph } from './types.js';

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { isMetaMask?: boolean };
  }
}

/**
 * EIP-712 domain pinned to 0G Galileo (chainId 16602) and the deployed
 * AgentNFT address. A signature for the testnet Studio deploy CANNOT be
 * replayed on mainnet or on a hypothetical second Galileo deployment,
 * because the verifyingContract address changes there.
 *
 * Keep this in lockstep with `apps/backend/src/studio/auth.ts`.
 */
export const STUDIO_DEPLOY_DOMAIN = {
  name: 'SovereignClaw Studio Deploy',
  version: '1',
  chainId: 16602,
  verifyingContract: '0xc3f997545da4AA8E70C82Aab82ECB48722740601',
} as const;

export const STUDIO_DEPLOY_TYPES: Record<string, Array<{ name: string; type: string }>> = {
  StudioDeploy: [
    { name: 'graphSha', type: 'bytes32' },
    { name: 'nonce', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

export interface StudioDeployClaim {
  graphSha: string;
  nonce: string;
  timestamp: number;
}

export interface SignedStudioDeployClaim {
  address: string;
  signature: string;
  claim: StudioDeployClaim;
}

export interface ConnectedWallet {
  address: string;
  chainId: number;
  provider: BrowserProvider;
}

export function isWalletAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.ethereum;
}

export async function connect(): Promise<ConnectedWallet> {
  if (!isWalletAvailable()) {
    throw new Error('No injected wallet found. Install MetaMask, Rabby, or similar.');
  }
  const eth = window.ethereum!;
  const provider = new BrowserProvider(eth);
  // eth_requestAccounts prompts the user if not yet authorized.
  await eth.request({ method: 'eth_requestAccounts' });
  const signer = await provider.getSigner();
  const address = getAddress(await signer.getAddress());
  const network = await provider.getNetwork();
  return { address, chainId: Number(network.chainId), provider };
}

/**
 * Compute a stable keccak256 hash of the graph JSON. We use
 * `JSON.stringify` with no replacer so key order follows object insertion
 * order — which is what the server uses too. If you change this, you
 * MUST change `apps/backend/src/studio/auth.ts` in the same commit.
 */
export function graphSha(graph: StudioGraph): string {
  return keccak256(toUtf8Bytes(JSON.stringify(graph)));
}

/**
 * Build a fresh random 32-byte nonce for a single Studio deploy. We use
 * `crypto.getRandomValues` (available in all modern browsers and Node
 * 20+). The server treats the nonce as opaque; it's the timestamp that
 * defends against long-delayed replays.
 */
export function freshNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return '0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signDeploy(
  wallet: ConnectedWallet,
  graph: StudioGraph,
): Promise<SignedStudioDeployClaim> {
  const claim: StudioDeployClaim = {
    graphSha: graphSha(graph),
    nonce: freshNonce(),
    timestamp: Math.floor(Date.now() / 1000),
  };
  const signer = await wallet.provider.getSigner();
  const signature = await signer.signTypedData(STUDIO_DEPLOY_DOMAIN, STUDIO_DEPLOY_TYPES, claim);
  return { address: wallet.address, signature, claim };
}
