'use client';

import { type DragEvent, useState } from 'react';
import type { NodeKind } from '../lib/types';

interface PaletteItem {
  kind: NodeKind;
  icon: string;
  label: string;
  desc: string;
  colorVar: string;
  dimVar: string;
  glowVar: string;
}

const GROUPS: Array<{
  id: string;
  label: string;
  icon: string;
  items: PaletteItem[];
}> = [
  {
    id: 'data',
    label: 'Data & Compute',
    icon: '💡',
    items: [
      {
        kind: 'memory',
        icon: '🗄️',
        label: 'Memory',
        desc: 'Sovereign 0G Log storage',
        colorVar: 'var(--purple)',
        dimVar: 'rgba(176,111,255,0.1)',
        glowVar: 'rgba(176,111,255,0.2)',
      },
      {
        kind: 'inference',
        icon: '🧠',
        label: 'Inference',
        desc: 'TEE-verified 0G compute',
        colorVar: 'var(--cyan)',
        dimVar: 'rgba(0,217,255,0.08)',
        glowVar: 'rgba(0,217,255,0.2)',
      },
    ],
  },
  {
    id: 'logic',
    label: 'Logic & Actions',
    icon: '⚡',
    items: [
      {
        kind: 'tool',
        icon: '🔧',
        label: 'Tool',
        desc: 'HTTP / onchain / file',
        colorVar: 'var(--orange)',
        dimVar: 'rgba(255,149,68,0.1)',
        glowVar: 'rgba(255,149,68,0.18)',
      },
      {
        kind: 'reflection',
        icon: '🔄',
        label: 'Reflection',
        desc: 'Self-critique + learnings',
        colorVar: 'var(--green)',
        dimVar: 'rgba(0,255,136,0.08)',
        glowVar: 'rgba(0,255,136,0.18)',
      },
    ],
  },
  {
    id: 'agents',
    label: 'Agents & Swarms',
    icon: '🤖',
    items: [
      {
        kind: 'agent',
        icon: '🤖',
        label: 'Agent',
        desc: 'Role + prompt → iNFT',
        colorVar: 'var(--pink)',
        dimVar: 'rgba(255,92,138,0.1)',
        glowVar: 'rgba(255,92,138,0.2)',
      },
      {
        kind: 'mesh',
        icon: '🕸️',
        label: 'Mesh',
        desc: 'Multi-agent orchestrator',
        colorVar: 'var(--gold)',
        dimVar: 'rgba(255,209,102,0.08)',
        glowVar: 'rgba(255,209,102,0.18)',
      },
    ],
  },
];

function onDragStart(evt: DragEvent<HTMLDivElement>, kind: NodeKind): void {
  evt.dataTransfer.setData('application/sc-node-kind', kind);
  evt.dataTransfer.effectAllowed = 'move';
}

function PaletteGroup({
  group,
  defaultOpen = true,
}: {
  group: (typeof GROUPS)[0];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="palette-group">
      <button
        className={`palette-group-header${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="pgh-icon">{group.icon}</span>
        <span>{group.label}</span>
        <span className="pgh-chevron">▾</span>
      </button>

      <div className={`palette-group-items${open ? ' open' : ''}`}>
        {group.items.map((item) => (
          <div
            key={item.kind}
            className="palette-item"
            draggable
            onDragStart={(e) => onDragStart(e, item.kind)}
            title={`Drag "${item.label}" to canvas`}
            style={
              {
                '--item-color': item.colorVar,
                '--item-dim': item.dimVar,
                '--item-glow': item.glowVar,
              } as React.CSSProperties
            }
          >
            <div
              className="palette-item-icon"
              style={{ background: item.dimVar, borderColor: `${item.colorVar}33` }}
            >
              {item.icon}
            </div>
            <div className="palette-item-info">
              <div className="palette-item-label">{item.label}</div>
              <div className="palette-item-desc">{item.desc}</div>
            </div>
            <div className="palette-item-drag">⠿</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NodePalette(): JSX.Element {
  return (
    <aside className="panel" aria-label="Node palette">
      <div className="panel-header">
        <div className="panel-header-icon">🧩</div>
        <div className="panel-header-title">Palette</div>
        <div className="panel-header-badge">{GROUPS.reduce((a, g) => a + g.items.length, 0)} nodes</div>
      </div>

      <div className="palette-scroll">
        {GROUPS.map((g, i) => (
          <PaletteGroup key={g.id} group={g} defaultOpen={i === 0} />
        ))}
      </div>

      <div className="palette-footer">
        ⠿ drag to canvas<br />
        ◎ click to inspect<br />
        ⟶ drag handles to connect
      </div>
    </aside>
  );
}