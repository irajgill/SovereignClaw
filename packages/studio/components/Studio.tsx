'use client';

import { useEffect } from 'react';
import { ReactFlowProvider } from 'reactflow';
import { NodePalette } from './NodePalette';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { CodePreview } from './CodePreview';
import { DeployPanel } from './DeployPanel';
import { Header } from './Header';
import { useStudioStore } from '../lib/store';
import { seedGraph } from '../lib/seed-graph';

/**
 * Top-level Studio layout. On first mount, hydrate the canvas with the
 * 3-agent research swarm seed graph so an unfamiliar visitor can see a
 * working deploy in one click (spec §11.5 cut-line).
 */
export function Studio(): JSX.Element {
  const { nodes, reset } = useStudioStore();

  useEffect(() => {
    if (nodes.length === 0) {
      reset(seedGraph());
    }
    // Intentional: run once on mount to hydrate the seed graph.
  }, [nodes.length, reset]);

  return (
    <div className="studio-shell">
      <Header />
      <div className="studio-main">
        <NodePalette />
        <ReactFlowProvider>
          <Canvas />
        </ReactFlowProvider>
        <div className="right-col">
          <Inspector />
          <CodePreview />
          <DeployPanel />
        </div>
      </div>
    </div>
  );
}
