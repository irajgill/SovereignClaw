'use client';

import { useMemo, useState } from 'react';
import { useStudioStore } from '../lib/store';
import type {
  AgentNodeData,
  InferenceNodeData,
  MemoryNodeData,
  MeshNodeData,
  ReflectionNodeData,
  ToolNodeData,
} from '../lib/types';

/* ─── Collapsible section ────────────────────────────────────────────── */
function Section({
  icon,
  label,
  count,
  defaultOpen = true,
  children,
}: {
  icon: string;
  label: string;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="inspector-section">
      <button
        className={`inspector-section-header${open ? ' open' : ''}`}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="ish-icon">{icon}</span>
        <span className="ish-label">{label}</span>
        {count !== undefined && <span className="ish-count">{count}</span>}
        <span className="ish-chevron">▾</span>
      </button>
      <div className={`inspector-section-body${open ? ' open' : ''}`}>
        <div className="inspector-fields">{children}</div>
      </div>
    </div>
  );
}

/* ─── Field helpers ──────────────────────────────────────────────────── */
function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="inspector-field">
      <label>
        {icon && <span className="field-icon">{icon}</span>}
        {label}
      </label>
      {children}
    </div>
  );
}

function ToggleRow({
  icon,
  label,
  checked,
  onChange,
}: {
  icon: string;
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="toggle-row" onClick={() => onChange(!checked)}>
      <div className="toggle-row-label">
        <span className="tr-icon">{icon}</span>
        {label}
      </div>
      <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-slider" />
      </label>
    </div>
  );
}

/* ─── Per-kind forms ─────────────────────────────────────────────────── */
function MemoryForm({
  data,
  onChange,
}: {
  data: MemoryNodeData;
  onChange: (p: Partial<MemoryNodeData>) => void;
}) {
  return (
    <>
      <Section icon="🏷️" label="Configuration">
        <Field label="Namespace" icon="📁">
          <input
            type="text"
            value={data.namespace}
            onChange={(e) => onChange({ namespace: e.target.value })}
            placeholder="my-agent-state"
          />
        </Field>
        <ToggleRow
          icon="🔒"
          label="Encrypt with wallet-derived KEK"
          checked={data.encrypted}
          onChange={(v) => onChange({ encrypted: v })}
        />
      </Section>
      <Section icon="ℹ️" label="About" defaultOpen={false}>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10.5,
            color: 'var(--ink-3)',
            lineHeight: 1.6,
          }}
        >
          AES-256-GCM encrypted. KEK derived from EIP-191 wallet signature via HKDF-SHA-256. Backed
          by 0G Storage Log — immutable, append-only, content-addressed.
        </p>
      </Section>
    </>
  );
}

function InferenceForm({
  data,
  onChange,
}: {
  data: InferenceNodeData;
  onChange: (p: Partial<InferenceNodeData>) => void;
}) {
  return (
    <>
      <Section icon="⚙️" label="Configuration">
        <Field label="Model identifier" icon="🧠">
          <input
            type="text"
            value={data.model}
            onChange={(e) => onChange({ model: e.target.value })}
            placeholder="qwen/qwen-2.5-7b-instruct"
          />
        </Field>
        <ToggleRow
          icon="🛡️"
          label="Require TEE attestation"
          checked={data.verifiable}
          onChange={(v) => onChange({ verifiable: v })}
        />
        <Field label="Pin provider address" icon="📍">
          <input
            type="text"
            placeholder="0x… (optional)"
            value={data.providerAddress ?? ''}
            onChange={(e) => onChange({ providerAddress: e.target.value || undefined })}
          />
        </Field>
      </Section>
    </>
  );
}

function ToolForm({
  data,
  onChange,
}: {
  data: ToolNodeData;
  onChange: (p: Partial<ToolNodeData>) => void;
}) {
  return (
    <Section icon="🔧" label="Configuration">
      <Field label="Tool name" icon="🏷️">
        <input
          type="text"
          value={data.toolName}
          onChange={(e) => onChange({ toolName: e.target.value })}
          placeholder="fetch-data"
        />
      </Field>
      <Field label="Tool kind" icon="⚡">
        <select
          value={data.toolKind}
          onChange={(e) => onChange({ toolKind: e.target.value as ToolNodeData['toolKind'] })}
        >
          <option value="http">🌐 HTTP — REST / webhook call</option>
          <option value="onchain">⛓️ On-chain — EVM transaction</option>
          <option value="file">📄 File — read / write / generate</option>
        </select>
      </Field>
      <p
        style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          color: 'var(--ink-4)',
          lineHeight: 1.5,
        }}
      >
        ⚠ Full tool runtime ships with IncomeClaw Phase 9.
      </p>
    </Section>
  );
}

function ReflectionForm({
  data,
  onChange,
}: {
  data: ReflectionNodeData;
  onChange: (p: Partial<ReflectionNodeData>) => void;
}) {
  const isCustom = typeof data.rubric !== 'string';
  const customRubric = isCustom
    ? (data.rubric as { kind: 'custom'; name: string; description: string; criteria: string })
    : null;

  return (
    <>
      <Section icon="🔄" label="Critique config">
        <Field label="Rubric" icon="📋">
          <select
            value={isCustom ? 'custom' : (data.rubric as string)}
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'custom') {
                onChange({
                  rubric: {
                    kind: 'custom',
                    name: customRubric?.name ?? 'my-rubric',
                    description: customRubric?.description ?? '',
                    criteria: customRubric?.criteria ?? '',
                  },
                });
              } else {
                onChange({ rubric: v as 'accuracy' | 'completeness' | 'safety' | 'concision' });
              }
            }}
          >
            <option value="accuracy">✅ accuracy</option>
            <option value="completeness">📝 completeness</option>
            <option value="safety">🛡️ safety</option>
            <option value="concision">✂️ concision</option>
            <option value="custom">🎨 custom…</option>
          </select>
        </Field>

        <Field label="Critic mode" icon="👤">
          <select
            value={data.critic}
            onChange={(e) => onChange({ critic: e.target.value as ReflectionNodeData['critic'] })}
          >
            <option value="self">self — same model critiques itself</option>
            <option value="peer">peer — peer agent (coming soon)</option>
          </select>
        </Field>

        <Field label="Rounds" icon="🔁">
          <input
            type="number"
            min={1}
            max={5}
            value={data.rounds}
            onChange={(e) => onChange({ rounds: Number(e.target.value) || 1 })}
          />
        </Field>

        <Field label="Accept threshold" icon="🎯">
          <div className="range-row">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={data.threshold}
              onChange={(e) => onChange({ threshold: Number(e.target.value) })}
            />
            <span className="range-val">{data.threshold.toFixed(2)}</span>
          </div>
        </Field>

        <ToggleRow
          icon="💾"
          label="Persist learnings to 0G Log"
          checked={data.persistLearnings}
          onChange={(v) => onChange({ persistLearnings: v })}
        />
      </Section>

      {isCustom && customRubric && (
        <Section icon="🎨" label="Custom rubric">
          <Field label="Name" icon="🏷️">
            <input
              type="text"
              value={customRubric.name}
              onChange={(e) => onChange({ rubric: { ...customRubric, name: e.target.value } })}
              placeholder="my-rubric"
            />
          </Field>
          <Field label="Description" icon="📄">
            <input
              type="text"
              value={customRubric.description}
              onChange={(e) =>
                onChange({ rubric: { ...customRubric, description: e.target.value } })
              }
              placeholder="What does this grade?"
            />
          </Field>
          <Field label="Criteria" icon="📋">
            <textarea
              rows={4}
              value={customRubric.criteria}
              onChange={(e) => onChange({ rubric: { ...customRubric, criteria: e.target.value } })}
              placeholder="1. Facts are correct&#10;2. Tone matches&#10;3. No unsupported claims."
            />
          </Field>
        </Section>
      )}
    </>
  );
}

function AgentForm({
  data,
  onChange,
}: {
  data: AgentNodeData;
  onChange: (p: Partial<AgentNodeData>) => void;
}) {
  return (
    <>
      <Section icon="🤖" label="Identity">
        <Field label="Role" icon="🏷️">
          <input
            type="text"
            value={data.role}
            onChange={(e) => onChange({ role: e.target.value })}
            placeholder="researcher"
          />
        </Field>
      </Section>
      <Section icon="💬" label="System prompt">
        <Field label="Prompt" icon="📝">
          <textarea
            value={data.systemPrompt}
            onChange={(e) => onChange({ systemPrompt: e.target.value })}
            placeholder="You are a careful researcher…"
            style={{ minHeight: 90 }}
          />
        </Field>
        <p
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--ink-4)',
            lineHeight: 1.5,
          }}
        >
          🪙 Each agent mints its own ERC-7857 iNFT on deploy — one tx per role.
        </p>
      </Section>
    </>
  );
}

function MeshForm({
  data,
  onChange,
}: {
  data: MeshNodeData;
  onChange: (p: Partial<MeshNodeData>) => void;
}) {
  return (
    <>
      <Section icon="🕸️" label="Identity">
        <Field label="Mesh ID" icon="🏷️">
          <input
            type="text"
            value={data.meshId}
            onChange={(e) => onChange({ meshId: e.target.value })}
            placeholder="my-swarm-v1"
          />
        </Field>
        <Field label="Pattern" icon="🔀">
          <select value={data.pattern} disabled>
            <option value="planExecuteCritique">planExecuteCritique</option>
          </select>
        </Field>
      </Section>
      <Section icon="🎯" label="Task & limits">
        <Field label="Task" icon="📋">
          <textarea
            value={data.task}
            onChange={(e) => onChange({ task: e.target.value })}
            placeholder="Describe what this swarm should do…"
            style={{ minHeight: 72 }}
          />
        </Field>
        <div className="num-row">
          <Field label="Max rounds" icon="🔁">
            <input
              type="number"
              min={1}
              max={10}
              value={data.maxRounds}
              onChange={(e) => onChange({ maxRounds: Number(e.target.value) || 1 })}
            />
          </Field>
          <Field label="Accept threshold" icon="🎯">
            <input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={data.acceptThreshold}
              onChange={(e) => onChange({ acceptThreshold: Number(e.target.value) })}
            />
          </Field>
        </div>
      </Section>
    </>
  );
}

/* ─── Main Inspector ─────────────────────────────────────────────────── */
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
        <div className="panel-header">
          <div className="panel-header-icon">🔍</div>
          <div className="panel-header-title">Inspector</div>
        </div>
        <div className="inspector-empty">
          <div className="ie-graphic">🧩</div>
          <div className="ie-title">Nothing selected</div>
          <p className="ie-sub">
            Click any node on the canvas
            <br />
            to configure it here.
          </p>
        </div>
      </aside>
    );
  }

  const kindIcons: Record<string, string> = {
    memory: '🗄️',
    inference: '🧠',
    tool: '🔧',
    reflection: '🔄',
    agent: '🤖',
    mesh: '🕸️',
  };

  return (
    <aside className="panel panel-right">
      <div className="panel-header">
        <div className="panel-header-icon">{kindIcons[node.data.kind] ?? '◇'}</div>
        <div className="panel-header-title">{node.data.kind}</div>
        <div
          className="pill neutral"
          style={{ marginLeft: 'auto', fontSize: 9, fontFamily: 'var(--font-mono)' }}
        >
          {node.id}
        </div>
      </div>

      <div className="inspector-wrap">
        {/* Per-kind form */}
        {node.data.kind === 'memory' && (
          <MemoryForm
            data={node.data as MemoryNodeData}
            onChange={(p) => patchNodeData(node.id, p)}
          />
        )}
        {node.data.kind === 'inference' && (
          <InferenceForm
            data={node.data as InferenceNodeData}
            onChange={(p) => patchNodeData(node.id, p)}
          />
        )}
        {node.data.kind === 'tool' && (
          <ToolForm data={node.data as ToolNodeData} onChange={(p) => patchNodeData(node.id, p)} />
        )}
        {node.data.kind === 'reflection' && (
          <ReflectionForm
            data={node.data as ReflectionNodeData}
            onChange={(p) => patchNodeData(node.id, p)}
          />
        )}
        {node.data.kind === 'agent' && (
          <AgentForm
            data={node.data as AgentNodeData}
            onChange={(p) => patchNodeData(node.id, p)}
          />
        )}
        {node.data.kind === 'mesh' && (
          <MeshForm data={node.data as MeshNodeData} onChange={(p) => patchNodeData(node.id, p)} />
        )}

        {/* Connections */}
        <Section icon="🔗" label="Connections" count={incidentEdges.length} defaultOpen={false}>
          {incidentEdges.length === 0 ? (
            <p className="empty-tip">No connections yet. Drag from a handle to connect nodes.</p>
          ) : (
            <div className="edges-list">
              {incidentEdges.map((e) => (
                <div key={e.id} className="edge-item">
                  <code>
                    {e.source} → {e.target}
                  </code>
                  {e.data?.edgeRole && <span className="edge-role-badge">{e.data.edgeRole}</span>}
                  <button
                    className="btn xs icon-btn"
                    onClick={() => removeEdge(e.id)}
                    title="Remove edge"
                    style={{ color: 'var(--pink)', padding: '2px 5px' }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Danger zone */}
        <Section icon="⚠️" label="Danger zone" defaultOpen={false}>
          <button
            className="btn danger sm"
            onClick={() => removeNode(node.id)}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            🗑️ Delete this node
          </button>
        </Section>
      </div>
    </aside>
  );
}
