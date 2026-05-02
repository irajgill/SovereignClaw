'use client';

import { useMemo } from 'react';
import { useStudioStore } from '../lib/store';
import type {
  AgentNodeData,
  InferenceNodeData,
  MemoryNodeData,
  MeshNodeData,
  ReflectionNodeData,
  ToolNodeData,
} from '../lib/types';

export function Inspector(): JSX.Element {
  const { nodes, selectedId, patchNodeData, removeNode, edges, removeEdge } = useStudioStore();
  const node = useMemo(() => nodes.find((n) => n.id === selectedId), [nodes, selectedId]);
  const incidentEdges = useMemo(
    () => (node ? edges.filter((e) => e.source === node.id || e.target === node.id) : []),
    [edges, node],
  );

  if (!node) {
    return (
      <aside className="panel panel-right">
        <div className="panel-header">Inspector</div>
        <div className="empty">
          Nothing selected.
          <br />
          Click a node to edit its configuration.
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel panel-right">
      <div className="panel-header">
        {node.data.kind} · <span className="pill info">{node.id}</span>
      </div>
      <div className="inspector">
        {node.data.kind === 'memory' && (
          <MemoryForm
            data={node.data as MemoryNodeData}
            onChange={(patch) => patchNodeData(node.id, patch)}
          />
        )}
        {node.data.kind === 'inference' && (
          <InferenceForm
            data={node.data as InferenceNodeData}
            onChange={(patch) => patchNodeData(node.id, patch)}
          />
        )}
        {node.data.kind === 'tool' && (
          <ToolForm
            data={node.data as ToolNodeData}
            onChange={(patch) => patchNodeData(node.id, patch)}
          />
        )}
        {node.data.kind === 'reflection' && (
          <ReflectionForm
            data={node.data as ReflectionNodeData}
            onChange={(patch) => patchNodeData(node.id, patch)}
          />
        )}
        {node.data.kind === 'agent' && (
          <AgentForm
            data={node.data as AgentNodeData}
            onChange={(patch) => patchNodeData(node.id, patch)}
          />
        )}
        {node.data.kind === 'mesh' && (
          <MeshForm
            data={node.data as MeshNodeData}
            onChange={(patch) => patchNodeData(node.id, patch)}
          />
        )}

        <hr style={{ border: '1px solid var(--border)', margin: '6px 0' }} />
        <div className="help">
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Edges ({incidentEdges.length})</div>
          {incidentEdges.length === 0 && <div>None yet. Drag from a handle to connect.</div>}
          {incidentEdges.map((e) => (
            <div
              key={e.id}
              style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '2px 0' }}
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>
                {e.source} → {e.target} ({e.data?.edgeRole})
              </span>
              <button
                className="btn"
                style={{ padding: '2px 6px' }}
                onClick={() => removeEdge(e.id)}
              >
                remove
              </button>
            </div>
          ))}
        </div>

        <button
          className="btn"
          style={{ alignSelf: 'flex-start' }}
          onClick={() => removeNode(node.id)}
        >
          Delete node
        </button>
      </div>
    </aside>
  );
}

function MemoryForm({
  data,
  onChange,
}: {
  data: MemoryNodeData;
  onChange: (patch: Partial<MemoryNodeData>) => void;
}): JSX.Element {
  return (
    <>
      <label>
        Namespace
        <input
          type="text"
          value={data.namespace}
          onChange={(e) => onChange({ namespace: e.target.value })}
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={data.encrypted}
          onChange={(e) => onChange({ encrypted: e.target.checked })}
        />
        <span>encrypt with per-signer KEK (recommended)</span>
      </label>
      <div className="help">
        Memory backed by 0G Storage Log. When encrypted, a KEK derived from the deployer signer
        wraps every record at rest.
      </div>
    </>
  );
}

function InferenceForm({
  data,
  onChange,
}: {
  data: InferenceNodeData;
  onChange: (patch: Partial<InferenceNodeData>) => void;
}): JSX.Element {
  return (
    <>
      <label>
        Model
        <input
          type="text"
          value={data.model}
          onChange={(e) => onChange({ model: e.target.value })}
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={data.verifiable}
          onChange={(e) => onChange({ verifiable: e.target.checked })}
        />
        <span>require TEE attestation on each call</span>
      </label>
      <label>
        Provider address (optional)
        <input
          type="text"
          placeholder="0x…"
          value={data.providerAddress ?? ''}
          onChange={(e) => onChange({ providerAddress: e.target.value || undefined })}
        />
      </label>
    </>
  );
}

function ToolForm({
  data,
  onChange,
}: {
  data: ToolNodeData;
  onChange: (patch: Partial<ToolNodeData>) => void;
}): JSX.Element {
  return (
    <>
      <label>
        Tool name
        <input
          type="text"
          value={data.toolName}
          onChange={(e) => onChange({ toolName: e.target.value })}
        />
      </label>
      <label>
        Tool kind
        <select
          value={data.toolKind}
          onChange={(e) => onChange({ toolKind: e.target.value as ToolNodeData['toolKind'] })}
        >
          <option value="http">http</option>
          <option value="onchain">onchain</option>
          <option value="file">file</option>
        </select>
      </label>
      <div className="help">
        Tool wiring is scaffolded in v0; execution comes in IncomeClaw (Phase 9).
      </div>
    </>
  );
}

function ReflectionForm({
  data,
  onChange,
}: {
  data: ReflectionNodeData;
  onChange: (patch: Partial<ReflectionNodeData>) => void;
}): JSX.Element {
  return (
    <>
      <label>
        Rounds
        <input
          type="number"
          min={1}
          max={5}
          value={data.rounds}
          onChange={(e) => onChange({ rounds: Number(e.target.value) || 1 })}
        />
      </label>
      <label>
        Critic
        <select
          value={data.critic}
          onChange={(e) => onChange({ critic: e.target.value as ReflectionNodeData['critic'] })}
        >
          <option value="self">self</option>
          <option value="peer">peer (coming soon)</option>
        </select>
      </label>
      <label>
        Rubric
        <select
          value={data.rubric}
          onChange={(e) => onChange({ rubric: e.target.value as ReflectionNodeData['rubric'] })}
        >
          <option value="accuracy">accuracy</option>
          <option value="completeness">completeness</option>
          <option value="safety">safety</option>
          <option value="concision">concision</option>
        </select>
      </label>
      <label>
        Accept threshold
        <input
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={data.threshold}
          onChange={(e) => onChange({ threshold: Number(e.target.value) })}
        />
      </label>
      <label className="row">
        <input
          type="checkbox"
          checked={data.persistLearnings}
          onChange={(e) => onChange({ persistLearnings: e.target.checked })}
        />
        <span>persist learnings on 0G Log</span>
      </label>
    </>
  );
}

function AgentForm({
  data,
  onChange,
}: {
  data: AgentNodeData;
  onChange: (patch: Partial<AgentNodeData>) => void;
}): JSX.Element {
  return (
    <>
      <label>
        Role
        <input type="text" value={data.role} onChange={(e) => onChange({ role: e.target.value })} />
      </label>
      <label>
        System prompt
        <textarea
          value={data.systemPrompt}
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
        />
      </label>
      <div className="help">
        Each Agent mints its own iNFT on deploy (one transaction per role).
      </div>
    </>
  );
}

function MeshForm({
  data,
  onChange,
}: {
  data: MeshNodeData;
  onChange: (patch: Partial<MeshNodeData>) => void;
}): JSX.Element {
  return (
    <>
      <label>
        Mesh ID
        <input
          type="text"
          value={data.meshId}
          onChange={(e) => onChange({ meshId: e.target.value })}
        />
      </label>
      <label>
        Pattern
        <select value={data.pattern} disabled>
          <option value="planExecuteCritique">planExecuteCritique</option>
        </select>
      </label>
      <label>
        Task
        <textarea value={data.task} onChange={(e) => onChange({ task: e.target.value })} />
      </label>
      <label>
        Max rounds
        <input
          type="number"
          min={1}
          max={10}
          value={data.maxRounds}
          onChange={(e) => onChange({ maxRounds: Number(e.target.value) || 1 })}
        />
      </label>
      <label>
        Accept threshold
        <input
          type="number"
          step={0.05}
          min={0}
          max={1}
          value={data.acceptThreshold}
          onChange={(e) => onChange({ acceptThreshold: Number(e.target.value) })}
        />
      </label>
    </>
  );
}
