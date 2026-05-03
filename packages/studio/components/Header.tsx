'use client';

import { useState } from 'react';
import { useStudioStore } from '../lib/store';
import { seedGraph } from '../lib/seed-graph';
import { connect, isWalletAvailable } from '../lib/wallet';

export function Header(): JSX.Element {
  const { reset, asGraph, wallet, setWallet } = useStudioStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadSeed(): void {
    reset(seedGraph());
  }

  function clear(): void {
    reset({ version: 1, nodes: [], edges: [] });
  }

  function downloadJson(): void {
    const graph = asGraph();
    const blob = new Blob([JSON.stringify(graph, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sovereignclaw-graph-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleConnect(): Promise<void> {
    setError(null);
    setBusy(true);
    try {
      const w = await connect();
      setWallet({ address: w.address, chainId: w.chainId });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function disconnect(): void {
    setWallet(null);
  }

  const walletAvailable = isWalletAvailable();
  const shortAddress = wallet ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` : '';

  return (
    <header className="studio-header">
      <h1>
        ClawStudio <span className="muted">· visual SovereignClaw builder</span>
      </h1>
      <div className="actions">
        <button className="btn" onClick={loadSeed}>
          Load seed (3-agent swarm)
        </button>
        <button className="btn" onClick={clear}>
          Clear canvas
        </button>
        <button className="btn" onClick={downloadJson}>
          Download graph.json
        </button>
        {wallet ? (
          <button className="btn" onClick={disconnect} title={wallet.address}>
            {shortAddress} · chain {wallet.chainId} · disconnect
          </button>
        ) : walletAvailable ? (
          <button className="btn" onClick={handleConnect} disabled={busy}>
            {busy ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : (
          <span className="muted" title="No injected wallet detected">
            No wallet detected
          </span>
        )}
      </div>
      {error && (
        <div className="muted" style={{ color: '#d33', paddingLeft: 16 }}>
          wallet: {error}
        </div>
      )}
    </header>
  );
}
