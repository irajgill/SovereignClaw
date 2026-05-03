'use client';

import { useEffect, type ReactNode } from 'react';
import { Handle, Position, ReactFlowProvider, type NodeProps } from 'reactflow';
import type {
  AgentNodeData,
  InferenceNodeData,
  MemoryNodeData,
  MeshNodeData,
  NodeKind,
  ReflectionNodeData,
  StudioNodeData,
  ToolNodeData,
} from '../lib/types';
import { useStudioStore } from '../lib/store';
import { seedGraph } from '../lib/seed-graph';
import { NodePalette } from './NodePalette';
import { Canvas } from './Canvas';
import { Inspector } from './Inspector';
import { CodePreview } from './CodePreview';
import { DeployPanel } from './DeployPanel';
import { Header } from './Header';

/* ─── Per-kind visual config ─────────────────────────────────────────── */
const KIND_CONFIG: Record<
  NodeKind,
  {
    icon: string;
    label: string;
    badge: string;
    gradient: string;
  }
> = {
  memory: {
    icon: '🗄️',
    label: 'MEMORY',
    badge: '0G Log',
    gradient: 'linear-gradient(90deg, #b06fff, #6baeff)',
  },
  inference: {
    icon: '🧠',
    label: 'INFERENCE',
    badge: 'TEE',
    gradient: 'linear-gradient(90deg, #00d9ff, #00ff88)',
  },
  tool: {
    icon: '🔧',
    label: 'TOOL',
    badge: 'action',
    gradient: 'linear-gradient(90deg, #ff9544, #ffd166)',
  },
  reflection: {
    icon: '🔄',
    label: 'REFLECTION',
    badge: 'self-critique',
    gradient: 'linear-gradient(90deg, #00ff88, #00d9ff)',
  },
  agent: {
    icon: '🤖',
    label: 'AGENT',
    badge: 'iNFT',
    gradient: 'linear-gradient(90deg, #ff5c8a, #b06fff)',
  },
  mesh: {
    icon: '🕸️',
    label: 'MESH',
    badge: 'swarm',
    gradient: 'linear-gradient(90deg, #ffd166, #ff9544)',
  },
};

/* ─── Stat row helpers ───────────────────────────────────────────────── */
function NodeStat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="sc-node-stat-row">
      <span className="sc-node-stat-label">{label}</span>
      <span className={`sc-node-stat-value${accent ? ' accent' : ''}`}>{value}</span>
    </div>
  );
}

function NodeTag({ children, active }: { children: ReactNode; active?: boolean }) {
  return <span className={`sc-node-tag${active ? ' active' : ''}`}>{children}</span>;
}

/* ─── Node body builders per kind ────────────────────────────────────── */
function MemoryBody({ data }: { data: MemoryNodeData }) {
  return (
    <>
      <div className="sc-node-body">
        <NodeStat label="namespace" value={data.namespace} accent />
        <NodeStat label="storage" value="0G Log" />
      </div>
      <div className="sc-node-footer">
        <NodeTag active={data.encrypted}>🔒 encrypted</NodeTag>
        <NodeTag>append-only</NodeTag>
        <NodeTag>sovereign</NodeTag>
      </div>
    </>
  );
}

function InferenceBody({ data }: { data: InferenceNodeData }) {
  const shortModel = data.model.split('/').pop() ?? data.model;
  return (
    <>
      <div className="sc-node-body">
        <NodeStat label="model" value={shortModel} accent />
        <NodeStat label="route" value="0G Router" />
        {data.providerAddress && (
          <NodeStat label="provider" value={`${data.providerAddress.slice(0, 8)}…`} />
        )}
      </div>
      <div className="sc-node-footer">
        <NodeTag active={data.verifiable}>✓ TEE verified</NodeTag>
        <NodeTag>OpenAI compat</NodeTag>
      </div>
    </>
  );
}

function ToolBody({ data }: { data: ToolNodeData }) {
  const kindIcons: Record<string, string> = { http: '🌐', onchain: '⛓️', file: '📄' };
  return (
    <>
      <div className="sc-node-body">
        <NodeStat label="name" value={data.toolName} accent />
        <NodeStat label="kind" value={data.toolKind} />
      </div>
      <div className="sc-node-footer">
        <NodeTag active>{kindIcons[data.toolKind] ?? '⚙'} {data.toolKind}</NodeTag>
        <NodeTag>v0 scaffold</NodeTag>
      </div>
    </>
  );
}

function ReflectionBody({ data }: { data: ReflectionNodeData }) {
  const rubricName = typeof data.rubric === 'string' ? data.rubric : data.rubric.name;
  return (
    <>
      <div className="sc-node-body">
        <NodeStat label="rubric" value={rubricName} accent />
        <NodeStat label="rounds" value={String(data.rounds)} />
        <NodeStat label="threshold" value={String(data.threshold)} />
      </div>
      <div className="sc-node-footer">
        <NodeTag active={data.critic === 'self'}>👤 self-critique</NodeTag>
        <NodeTag active={data.persistLearnings}>💾 learnings</NodeTag>
      </div>
    </>
  );
}

function AgentBody({ data }: { data: AgentNodeData }) {
  const preview = data.systemPrompt.trim().slice(0, 58);
  return (
    <>
      <div className="sc-node-body">
        <NodeStat label="role" value={data.role} accent />
        {preview && (
          <div className="sc-node-description">
            {preview}{data.systemPrompt.length > 58 ? '…' : ''}
          </div>
        )}
      </div>
      <div className="sc-node-footer">
        <NodeTag active>🪙 mints iNFT</NodeTag>
        <NodeTag>ERC-7857</NodeTag>
      </div>
    </>
  );
}

function MeshBody({ data }: { data: MeshNodeData }) {
  const taskPreview = data.task.slice(0, 55);
  return (
    <>
      <div className="sc-node-body">
        <NodeStat label="id" value={data.meshId} accent />
        <NodeStat label="pattern" value={data.pattern} />
        <NodeStat label="rounds" value={`≤${data.maxRounds}`} />
        {taskPreview && (
          <div className="sc-node-description">
            {taskPreview}{data.task.length > 55 ? '…' : ''}
          </div>
        )}
      </div>
      <div className="sc-node-footer">
        <NodeTag active>⚡ orchestrator</NodeTag>
        <NodeTag>0G Log bus</NodeTag>
        <NodeTag>th {data.acceptThreshold}</NodeTag>
      </div>
    </>
  );
}

/* ─── Main node component ────────────────────────────────────────────── */
export function StudioFlowNode(props: NodeProps<StudioNodeData>): JSX.Element {
  const { data, selected } = props;
  const cfg = KIND_CONFIG[data.kind];

  const title = (() => {
    switch (data.kind) {
      case 'memory':     return (data as MemoryNodeData).namespace;
      case 'inference':  return (data as InferenceNodeData).model.split('/').pop() ?? 'model';
      case 'tool':       return (data as ToolNodeData).toolName;
      case 'reflection': {
        const r = (data as ReflectionNodeData).rubric;
        return typeof r === 'string' ? r : r.name;
      }
      case 'agent':      return (data as AgentNodeData).role;
      case 'mesh':       return (data as MeshNodeData).meshId;
    }
  })();

  return (
    <div className={`sc-node sc-node--${data.kind}${selected ? ' selected' : ''}`}>
      {/* Animated top gradient line */}
      <div className="sc-node-glow-bar" style={{ background: cfg.gradient }} />

      {/* Left target handle */}
      <Handle
        type="target"
        position={Position.Left}
        style={{ background: 'var(--bg-3)', border: '1.5px solid rgba(255,255,255,0.16)', width: 11, height: 11 }}
      />

      {/* Header */}
      <div className="sc-node-header">
        <div className="sc-node-icon-wrap">
          {cfg.icon}
        </div>
        <div className="sc-node-meta">
          <div className="sc-node-kind">{cfg.label}</div>
          <div className="sc-node-title">{title}</div>
        </div>
        <div className="sc-node-badge">{cfg.badge}</div>
      </div>

      {/* Per-kind body */}
      {data.kind === 'memory'     && <MemoryBody data={data as MemoryNodeData} />}
      {data.kind === 'inference'  && <InferenceBody data={data as InferenceNodeData} />}
      {data.kind === 'tool'       && <ToolBody data={data as ToolNodeData} />}
      {data.kind === 'reflection' && <ReflectionBody data={data as ReflectionNodeData} />}
      {data.kind === 'agent'      && <AgentBody data={data as AgentNodeData} />}
      {data.kind === 'mesh'       && <MeshBody data={data as MeshNodeData} />}

      {/* Right source handle */}
      <Handle
        type="source"
        position={Position.Right}
        style={{ background: 'var(--bg-3)', border: '1.5px solid rgba(255,255,255,0.16)', width: 11, height: 11 }}
      />
    </div>
  );
}

export const nodeTypes = {
  memory: StudioFlowNode,
  inference: StudioFlowNode,
  tool: StudioFlowNode,
  reflection: StudioFlowNode,
  agent: StudioFlowNode,
  mesh: StudioFlowNode,
};

/* ─── Top-level Studio shell ─────────────────────────────────────────── */
export function Studio(): JSX.Element {
  const { nodes, reset } = useStudioStore();

  useEffect(() => {
    if (nodes.length === 0) {
      reset(seedGraph());
    }
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