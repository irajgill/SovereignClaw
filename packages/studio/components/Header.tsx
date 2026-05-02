'use client';

import { useStudioStore } from '../lib/store';
import { seedGraph } from '../lib/seed-graph';

export function Header(): JSX.Element {
  const { reset, asGraph } = useStudioStore();

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
      </div>
    </header>
  );
}
