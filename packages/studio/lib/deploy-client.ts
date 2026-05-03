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
 * Optional bearer token. The browser deploy flow doesn't need one —
 * Studio routes are gated server-side by EIP-712 wallet signatures
 * (STUDIO_SIGNER_ALLOWLIST). But if an operator wants to test against a
 * fully bearer-locked backend, they can pass `?bearer=...` once and we
 * cache it in localStorage. We deliberately don't read this from
 * NEXT_PUBLIC_* env vars (they're embedded in the bundle and would
 * defeat the auth gate).
 */
function resolveBearerToken(): string | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  const qp = params.get('bearer');
  if (qp) {
    window.localStorage.setItem('studio:bearer', qp);
    return qp;
  }
  return window.localStorage.getItem('studio:bearer');
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
  const bearer = resolveBearerToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  // Same-origin proxy at /api/studio/* sidesteps the upstream CORS gate.
  // Server-side route forwards to NEXT_PUBLIC_STUDIO_BACKEND_URL.
  const res = await fetch(`/api/studio/deploy`, {
    method: 'POST',
    headers,
    body: JSON.stringify(clientSig ? { graph, code, clientSig } : { graph, code }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`deploy failed: ${res.status} ${res.statusText} ${text}`);
  }
  const body = (await res.json()) as { deployId: string; status: DeployKickoff['status'] };
  return { ...body, backendUrl: url };
}

export async function fetchStatus(_backendUrl: string, deployId: string): Promise<DeployStatus> {
  // Same-origin proxy — `_backendUrl` is preserved in the API for backward
  // compatibility with callers that still pass it from DeployKickoff, but we
  // route through /api/studio/* to avoid the upstream CORS gate.
  const bearer = resolveBearerToken();
  const headers: Record<string, string> = {};
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const res = await fetch(`/api/studio/status/${deployId}`, { headers });
  if (!res.ok) {
    throw new Error(`status fetch failed: ${res.status}`);
  }
  return (await res.json()) as DeployStatus;
}
