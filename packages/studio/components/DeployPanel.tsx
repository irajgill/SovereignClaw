'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useStudioStore } from '../lib/store';
import { generateCode } from '../lib/codegen';
import { validateGraph } from '../lib/validator';
import { fetchStatus, postDeploy, type DeployStatus } from '../lib/deploy-client';
import { connect, signDeploy } from '../lib/wallet';

type Phase = 'idle' | 'signing' | 'posting' | 'polling' | 'done' | 'error';

const PHASE_ICONS: Record<Phase, string> = {
  idle: '🚀',
  signing: '✍️',
  posting: '📡',
  polling: '⚙️',
  done: '✅',
  error: '❌',
};

const PHASE_LABELS: Record<Phase, string> = {
  idle: 'Ready to deploy',
  signing: 'Awaiting wallet signature…',
  posting: 'Sending to backend…',
  polling: 'Deploying on 0G…',
  done: 'Deploy complete',
  error: 'Deploy failed',
};

const AGENT_ICONS: Record<string, string> = {
  planner: '🗺️',
  executor: '⚡',
  critic: '🔬',
  brain: '🧠',
  strategist: '📊',
  opener: '📨',
  closer: '🤝',
  operator: '🔧',
};

export function DeployPanel(): JSX.Element {
  const { nodes, edges, wallet } = useStudioStore();

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

  const [phase, setPhase] = useState<Phase>('idle');
  const [status, setStatus] = useState<DeployStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backendUrl, setBackendUrl] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => stopPolling(), []);

  function stopPolling() {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }

  async function deploy() {
    setError(null);
    setStatus(null);
    stopPolling();
    try {
      const { source } = generateCode(graph);
      let clientSig;
      if (wallet) {
        setPhase('signing');
        const live = await connect();
        clientSig = await signDeploy(live, graph);
      }
      setPhase('posting');
      const kickoff = await postDeploy(graph, source, clientSig);
      setBackendUrl(kickoff.backendUrl);
      setPhase('polling');

      pollTimer.current = setInterval(async () => {
        try {
          const s = await fetchStatus(kickoff.backendUrl, kickoff.deployId);
          setStatus(s);
          if (s.status === 'done' || s.status === 'error') {
            stopPolling();
            setPhase(s.status === 'done' ? 'done' : 'error');
            if (s.status === 'error' && s.error) setError(s.error);
          }
        } catch (err) {
          stopPolling();
          setPhase('error');
          setError((err as Error).message);
        }
      }, 1500);
    } catch (err) {
      setPhase('error');
      setError((err as Error).message);
    }
  }

  const isDeploying = phase === 'signing' || phase === 'posting' || phase === 'polling';
  const canDeploy = validation.ok && agentCount > 0 && !isDeploying;
  const errorCount = validation.issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="deploy-panel">
      {/* Top row */}
      <div className="deploy-top">
        <div className="deploy-icon">
          {isDeploying ? (
            <span className="spin" style={{ fontSize: 14 }}>
              ⚙️
            </span>
          ) : (
            PHASE_ICONS[phase]
          )}
        </div>
        <div className="deploy-heading">Deploy</div>
        <div className="deploy-chips">
          <span className="pill neutral" style={{ fontFamily: 'var(--font-mono)', fontSize: 9 }}>
            🤖 {agentCount}
          </span>
          {validation.ok ? (
            <span className="pill ok">✓ valid</span>
          ) : (
            <span className="pill warn">⚠ {errorCount} err</span>
          )}
        </div>
      </div>

      {/* Phase status line */}
      {isDeploying && (
        <div className="deploy-phase-line">
          <span className="status-dot active" />
          {PHASE_LABELS[phase]}
          {status?.status && phase === 'polling' && ` · ${status.status.replace('-', ' ')}`}
        </div>
      )}

      {/* Done state */}
      {phase === 'done' && (
        <div
          className="deploy-phase-line"
          style={{
            background: 'rgba(0,255,136,0.06)',
            borderColor: 'rgba(0,255,136,0.18)',
            color: 'var(--green)',
          }}
        >
          <span className="status-dot done" />
          Deploy complete — {agentCount} iNFT{agentCount !== 1 ? 's' : ''} minted on 0G
        </div>
      )}

      {/* Error state */}
      {phase === 'error' && error && (
        <div className="issue error" style={{ fontSize: 10 }}>
          <span className="issue-icon">❌</span>
          <div>
            <div className="issue-text">{error}</div>
          </div>
        </div>
      )}

      {/* CTA button */}
      <button
        className="btn primary"
        disabled={!canDeploy}
        onClick={deploy}
        style={{ justifyContent: 'center', padding: '9px 16px', fontSize: 12.5 }}
      >
        {isDeploying ? (
          <>
            <span className="spin">⚙</span> {PHASE_LABELS[phase]}
          </>
        ) : phase === 'done' ? (
          <>✓ Deploy again</>
        ) : (
          <>
            🚀 Deploy {agentCount} iNFT{agentCount !== 1 ? 's' : ''} to 0G
          </>
        )}
      </button>

      {/* Agent cards during/after deploy */}
      {status && status.agents.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {status.agents.map((a) => {
            const isMinted = Boolean(a.tokenId);
            return (
              <div key={a.nodeId} className={`deploy-agent-row${isMinted ? ' minted' : ''}`}>
                <span className="dar-icon">{AGENT_ICONS[a.role] ?? '🤖'}</span>
                <span className="dar-role">{a.role}</span>
                <span className={`dar-status ${isMinted ? 'done' : 'pending'}`}>
                  {isMinted ? (
                    a.explorerUrl ? (
                      <a href={a.explorerUrl} target="_blank" rel="noreferrer">
                        #{a.tokenId} ↗
                      </a>
                    ) : (
                      `#${a.tokenId}`
                    )
                  ) : (
                    <span className="pulse">minting…</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Deploy details */}
      {status && (
        <div className="deploy-status-grid">
          {status.manifestRoot && (
            <div className="ds-row">
              <span className="ds-key">manifest</span>
              <span className="ds-val">
                {status.storageExplorerUrl ? (
                  <a href={status.storageExplorerUrl} target="_blank" rel="noreferrer">
                    {status.manifestRoot.slice(0, 14)}… ↗
                  </a>
                ) : (
                  `${status.manifestRoot.slice(0, 14)}…`
                )}
              </span>
            </div>
          )}
          {backendUrl && (
            <div className="ds-row">
              <span className="ds-key">backend</span>
              <span className="ds-val">
                <a href={`${backendUrl}/healthz`} target="_blank" rel="noreferrer">
                  {backendUrl} ↗
                </a>
              </span>
            </div>
          )}

          {/* Log stream */}
          {status.logs.length > 0 && (
            <>
              <div className="ds-sep" />
              {status.logs.slice(-5).map((l, i) => (
                <div key={i} className="ds-row" style={{ gap: 6 }}>
                  <span className="ds-key" style={{ fontSize: 9.5, color: 'var(--ink-5)' }}>
                    {new Date(l.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                  <span className="ds-val" style={{ color: 'var(--ink-3)', fontSize: 10 }}>
                    {l.message}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
