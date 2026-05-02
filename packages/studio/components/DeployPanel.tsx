'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudioStore } from '../lib/store';
import { generateCode } from '../lib/codegen';
import { validateGraph } from '../lib/validator';
import { fetchStatus, postDeploy, type DeployStatus } from '../lib/deploy-client';

export function DeployPanel(): JSX.Element {
  const { nodes, edges } = useStudioStore();
  const graph = useMemo(
    () => ({
      version: 1 as const,
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: n.data.kind,
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        edgeRole: e.data?.edgeRole ?? 'inference',
      })),
    }),
    [nodes, edges],
  );

  const validation = useMemo(() => validateGraph(graph), [graph]);
  const agentCount = useMemo(() => nodes.filter((n) => n.data.kind === 'agent').length, [nodes]);

  const [deploying, setDeploying] = useState(false);
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopPolling(), []);

  function stopPolling(): void {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function deploy(): Promise<void> {
    setError(null);
    setStatus(null);
    setDeploying(true);
    stopPolling();
    try {
      const { source } = generateCode(graph);
      const kickoff = await postDeploy(graph, source);
      setBackendUrl(kickoff.backendUrl);
      pollTimer.current = setInterval(async () => {
        try {
          const s = await fetchStatus(kickoff.backendUrl, kickoff.deployId);
          setStatus(s);
          if (s.status === 'done' || s.status === 'error') {
            stopPolling();
            setDeploying(false);
          }
        } catch (err) {
          stopPolling();
          setDeploying(false);
          setError((err as Error).message);
        }
      }, 1500);
    } catch (err) {
      setDeploying(false);
      setError((err as Error).message);
    }
  }

  const canDeploy = validation.ok && agentCount > 0 && !deploying;

  return (
    <div className="deploy-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontWeight: 600 }}>Deploy</div>
        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
          {agentCount} agent{agentCount === 1 ? '' : 's'} ·{' '}
          <span className={validation.ok ? 'pill' : 'pill warn'}>
            {validation.ok
              ? 'valid'
              : `${validation.issues.filter((i) => i.severity === 'error').length} errors`}
          </span>
        </div>
      </div>
      <button className="btn primary" disabled={!canDeploy} onClick={deploy}>
        {deploying ? 'Deploying…' : `Deploy ${agentCount} iNFT${agentCount === 1 ? '' : 's'}`}
      </button>
      {error && <div className="issue error">deploy error: {error}</div>}
      {status && (
        <div className="deploy-status">
          <div className="row">
            <span>deployId</span>
            <span>{status.deployId}</span>
          </div>
          <div className="row">
            <span>status</span>
            <span>{status.status}</span>
          </div>
          {status.manifestRoot && (
            <div className="row">
              <span>manifest</span>
              <span>
                {status.storageExplorerUrl ? (
                  <a href={status.storageExplorerUrl} target="_blank" rel="noreferrer">
                    {status.manifestRoot.slice(0, 10)}…
                  </a>
                ) : (
                  <>{status.manifestRoot.slice(0, 10)}…</>
                )}
              </span>
            </div>
          )}
          {status.agents.length > 0 && (
            <>
              <hr style={{ border: '1px solid var(--border)', margin: '6px 0' }} />
              {status.agents.map((a) => (
                <div key={a.nodeId} className="row">
                  <span>{a.role}</span>
                  <span>
                    {a.explorerUrl ? (
                      <a href={a.explorerUrl} target="_blank" rel="noreferrer">
                        iNFT #{a.tokenId}
                      </a>
                    ) : (
                      <>pending…</>
                    )}
                  </span>
                </div>
              ))}
            </>
          )}
          {status.logs.length > 0 && (
            <>
              <hr style={{ border: '1px solid var(--border)', margin: '6px 0' }} />
              {status.logs.slice(-8).map((l, i) => (
                <div key={i} className="row">
                  <span>{new Date(l.at).toLocaleTimeString()}</span>
                  <span>{l.message}</span>
                </div>
              ))}
            </>
          )}
          {backendUrl && (
            <div className="row" style={{ marginTop: 4 }}>
              <span>backend</span>
              <span>
                <a href={`${backendUrl}/healthz`} target="_blank" rel="noreferrer">
                  {backendUrl}
                </a>
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
