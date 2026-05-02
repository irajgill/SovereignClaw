'use client';

import { Handle, Position, type NodeProps } from 'reactflow';
import type {
  AgentNodeData,
  InferenceNodeData,
  MemoryNodeData,
  MeshNodeData,
  NodeKind,
  ReflectionNodeData,
  StudioNodeData,
  ToolNodeData,
} from '../../lib/types';

function kindClass(kind: NodeKind): string {
  return `sc-node sc-node--${kind}`;
}

function summaryFor(data: StudioNodeData): string {
  switch (data.kind) {
    case 'memory': {
      const m = data as MemoryNodeData;
      return `ns: ${m.namespace} · ${m.encrypted ? 'encrypted' : 'plain'}`;
    }
    case 'inference': {
      const i = data as InferenceNodeData;
      return `model: ${i.model}${i.verifiable ? ' · TEE' : ''}`;
    }
    case 'tool': {
      const t = data as ToolNodeData;
      return `${t.toolKind}: ${t.toolName}`;
    }
    case 'reflection': {
      const r = data as ReflectionNodeData;
      return `rubric: ${r.rubric} · rounds: ${r.rounds} · th ${r.threshold}`;
    }
    case 'agent': {
      const a = data as AgentNodeData;
      return a.systemPrompt.slice(0, 80) + (a.systemPrompt.length > 80 ? '…' : '');
    }
    case 'mesh': {
      const m = data as MeshNodeData;
      return `${m.pattern} · ≤${m.maxRounds} rounds · accept ≥ ${m.acceptThreshold}`;
    }
  }
}

function titleFor(data: StudioNodeData): string {
  switch (data.kind) {
    case 'memory':
      return (data as MemoryNodeData).namespace;
    case 'inference':
      return (data as InferenceNodeData).model;
    case 'tool':
      return (data as ToolNodeData).toolName;
    case 'reflection':
      return (data as ReflectionNodeData).rubric;
    case 'agent':
      return (data as AgentNodeData).role;
    case 'mesh':
      return (data as MeshNodeData).meshId;
  }
}

export function StudioFlowNode(props: NodeProps<StudioNodeData>): JSX.Element {
  const { data, selected } = props;
  return (
    <div className={`${kindClass(data.kind)}${selected ? ' selected' : ''}`}>
      <Handle type="target" position={Position.Left} style={{ background: '#3b4556' }} />
      <div className="kind">{data.kind}</div>
      <div className="title">{titleFor(data)}</div>
      <div className="summary">{summaryFor(data)}</div>
      <Handle type="source" position={Position.Right} style={{ background: '#3b4556' }} />
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
