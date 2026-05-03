/**
 * Studio deploy authentication (Phase 9).
 *
 * Verifies a client-supplied EIP-712 signature over `{graphSha, nonce,
 * timestamp}` against `STUDIO_SIGNER_ALLOWLIST`. When the allow-list is
 * empty / unset, the verifier opens up to any client (dev mode) and
 * emits a warning — the server.ts log line makes this visible so an
 * operator can't accidentally ship open-mode to the internet.
 *
 * The EIP-712 domain + types here MUST match
 * `packages/studio/lib/wallet.ts`. Any drift is a consensus break
 * between client and server; a small fixture test pins both.
 */
import { getAddress, keccak256, toUtf8Bytes, verifyTypedData } from 'ethers';

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

export interface StudioAuthConfig {
  /** Bare list of checksummed addresses; empty means "allow all". */
  allowList: string[];
  /** Maximum allowed drift between `claim.timestamp` and server now, seconds. */
  maxTimestampDriftSec: number;
}

export type StudioAuthResult =
  | { ok: true; signer: string; open: boolean }
  | {
      ok: false;
      code: 'no-sig' | 'timestamp-skew' | 'bad-sig' | 'not-allowed' | 'graph-mismatch';
      detail: string;
    };

/**
 * Canonical graphSha — keccak256 of `JSON.stringify(graph)`. MUST match
 * `packages/studio/lib/wallet.ts#graphSha`.
 */
export function computeGraphSha(graph: unknown): string {
  return keccak256(toUtf8Bytes(JSON.stringify(graph)));
}

export function verifyStudioDeploy(
  graph: unknown,
  clientSig: SignedStudioDeployClaim | undefined,
  config: StudioAuthConfig,
): StudioAuthResult {
  const openMode = config.allowList.length === 0;

  if (!clientSig) {
    if (openMode) {
      return { ok: true, signer: '0x0000000000000000000000000000000000000000', open: true };
    }
    return {
      ok: false,
      code: 'no-sig',
      detail:
        'STUDIO_SIGNER_ALLOWLIST is set; clientSig is required. Include the EIP-712 signed claim in the POST body.',
    };
  }

  // 1. Replay defense: reject claims whose timestamp drifted too far.
  const nowSec = Math.floor(Date.now() / 1000);
  const drift = Math.abs(nowSec - clientSig.claim.timestamp);
  if (drift > config.maxTimestampDriftSec) {
    return {
      ok: false,
      code: 'timestamp-skew',
      detail: `claim.timestamp is ${drift}s out; max allowed is ${config.maxTimestampDriftSec}s`,
    };
  }

  // 2. The graph the client signed must equal the graph they POSTed.
  //    Without this check, the sig could be replayed across graphs.
  const expectedSha = computeGraphSha(graph);
  if (expectedSha.toLowerCase() !== clientSig.claim.graphSha.toLowerCase()) {
    return {
      ok: false,
      code: 'graph-mismatch',
      detail: `claim.graphSha ${clientSig.claim.graphSha} does not match request graph sha ${expectedSha}`,
    };
  }

  // 3. Recover signer; compare to the claimed address + allow-list.
  let recovered: string;
  try {
    recovered = verifyTypedData(
      STUDIO_DEPLOY_DOMAIN,
      STUDIO_DEPLOY_TYPES,
      clientSig.claim,
      clientSig.signature,
    );
  } catch (err) {
    return {
      ok: false,
      code: 'bad-sig',
      detail: `verifyTypedData threw: ${(err as Error).message}`,
    };
  }
  const recoveredChecksum = getAddress(recovered);
  const claimedChecksum = (() => {
    try {
      return getAddress(clientSig.address);
    } catch {
      return '';
    }
  })();
  if (recoveredChecksum !== claimedChecksum) {
    return {
      ok: false,
      code: 'bad-sig',
      detail: `recovered signer ${recoveredChecksum} does not match claimed ${claimedChecksum}`,
    };
  }

  if (openMode) {
    // Signed request in open mode: still accept, but record the signer.
    return { ok: true, signer: recoveredChecksum, open: true };
  }
  if (!config.allowList.some((a) => a.toLowerCase() === recoveredChecksum.toLowerCase())) {
    return {
      ok: false,
      code: 'not-allowed',
      detail: `signer ${recoveredChecksum} is not in STUDIO_SIGNER_ALLOWLIST`,
    };
  }
  return { ok: true, signer: recoveredChecksum, open: false };
}
