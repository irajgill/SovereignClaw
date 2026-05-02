'use client';

import type { DragEvent } from 'react';
import type { NodeKind } from '../lib/types';

const ITEMS: Array<{ kind: NodeKind; color: string; description: string }> = [
  { kind: 'memory', color: '#a78bfa', description: 'sovereign memory on 0G Log' },
  { kind: 'inference', color: '#60a5fa', description: 'TEE-verified 0G compute' },
  { kind: 'tool', color: '#f59e0b', description: 'http / onchain / file call' },
  { kind: 'reflection', color: '#34d399', description: 'self-critique + learnings' },
  { kind: 'agent', color: '#f87171', description: 'role + prompt; iNFT per node' },
  { kind: 'mesh', color: '#6ee7b7', description: 'multi-agent orchestration' },
];

function onDragStart(evt: DragEvent<HTMLDivElement>, kind: NodeKind): void {
  evt.dataTransfer.setData('application/sc-node-kind', kind);
  evt.dataTransfer.effectAllowed = 'move';
}

export function NodePalette(): JSX.Element {
  return (
    <aside className="panel" aria-label="Node palette">
      <div className="panel-header">Nodes</div>
      {ITEMS.map((it) => (
        <div
          key={it.kind}
          className="palette-item"
          draggable
          onDragStart={(e) => onDragStart(e, it.kind)}
          title={it.description}
        >
          <span className="dot" style={{ background: it.color }} />
          <div className="label">{it.kind}</div>
        </div>
      ))}
      <div className="empty">
        Drag a node onto the canvas.
        <br />
        Click once to configure on the right.
        <br />
        Connect by dragging from a node&apos;s right edge to another&apos;s left edge, then pick an
        edge role when prompted.
      </div>
    </aside>
  );
}
