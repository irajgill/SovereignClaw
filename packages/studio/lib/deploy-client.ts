/**
 * Tiny browser client for the Studio deploy routes on apps/backend.
 *
 * The backend is a long-running Hono service the user starts with
 * `pnpm --filter @sovereignclaw/backend dev`. For v0 the Studio assumes it
 * lives on http://localhost:8787; callers can override via
 * `?backend=` query param, NEXT_PUBLIC_STUDIO_BACKEND_URL, or a runtime
 * setter exposed from the header dropdown (Phase 7.1 will replace this
 * with a connected-wallet manifest flow).
 */
import type { StudioGraph } from './types.js';
import type { SignedStudioDeployClaim } from './wallet.js';

export interface DeployAgent {
  role: string;
  nodeId: string;
  tokenId?: string;
  txHash?: string;
  explorerUrl?: string;
}

export interface DeployStatus {
  deployId: string;
  status: 'queued' | 'bundling' | 'writing-manifest' | 'minting' | 'done' | 'error';
  startedAt: number;
  finishedAt?: number;
  error?: string;
  manifestRoot?: string;
  storageExplorerUrl?: string;
  agents: DeployAgent[];
  logs: Array<{ at: number; level: 'info' | 'warn' | 'error'; message: string }>;
}

export interface DeployKickoff {
  deployId: string;
  status: 'queued' | 'bundling';
  backendUrl: string;
}

function resolveBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const qp = params.get('backend');
    if (qp) return qp;
    const ls = window.localStorage.getItem('studio:backend');
    if (ls) return ls;
  }
  return process.env.NEXT_PUBLIC_STUDIO_BACKEND_URL ?? 'http://localhost:8787';
}

/**
 * POST /studio/deploy.
 *
 * Third argument (Phase 9): optional signed claim. When the backend has
 * `STUDIO_SIGNER_ALLOWLIST` set, this is REQUIRED and the backend
 * rejects 401 without it. When unset, the backend accepts unsigned
 * requests (local dev) but will log a warning so operators notice.
 */
export async function postDeploy(
  graph: StudioGraph,
  code: string,
  clientSig?: SignedStudioDeployClaim,
): Promise<DeployKickoff> {
  const url = resolveBackendUrl();
  const res = await fetch(`${url}/studio/deploy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(clientSig ? { graph, code, clientSig } : { graph, code }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`deploy failed: ${res.status} ${res.statusText} ${text}`);
  }
  const body = (await res.json()) as { deployId: string; status: DeployKickoff['status'] };
  return { ...body, backendUrl: url };
}

export async function fetchStatus(backendUrl: string, deployId: string): Promise<DeployStatus> {
  const res = await fetch(`${backendUrl}/studio/status/${deployId}`);
  if (!res.ok) {
    throw new Error(`status fetch failed: ${res.status}`);
  }
  return (await res.json()) as DeployStatus;
}
