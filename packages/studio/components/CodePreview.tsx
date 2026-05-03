'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useStudioStore } from '../lib/store';
import { generateCode } from '../lib/codegen';
import { validateGraph, type ValidationIssue } from '../lib/validator';

const Monaco = dynamic(() => import('@monaco-editor/react').then((m) => m.default), {
  ssr: false,
  loading: () => (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: 'var(--ink-3)',
        fontFamily: 'var(--font-mono)',
        fontSize: 11,
        gap: 8,
      }}
    >
      <span className="spin">⚙</span> Loading Monaco editor…
    </div>
  ),
});

type Tab = 'code' | 'graph' | 'issues';

const TABS: Array<{ id: Tab; icon: string; label: string }> = [
  { id: 'code', icon: '📄', label: 'TS source' },
  { id: 'graph', icon: '🗂️', label: 'graph.json' },
  { id: 'issues', icon: '🔍', label: 'Issues' },
];

export function CodePreview(): JSX.Element {
  const { nodes, edges } = useStudioStore();
  const [tab, setTab] = useState<Tab>('code');

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
  const code = useMemo(() => {
    try {
      return generateCode(graph).source;
    } catch (err) {
      return `// codegen error: ${(err as Error).message}`;
    }
  }, [graph]);
  const graphJson = useMemo(() => JSON.stringify(graph, null, 2), [graph]);

  const issueCount = validation.issues.length;
  const _errorCount = validation.issues.filter((i) => i.severity === 'error').length;

  return (
    <div className="code-panel">
      <div className="code-tabs">
        {TABS.map(({ id, icon, label }) => {
          const isCurrent = tab === id;
          const hasBadge = id === 'issues' && issueCount > 0;
          return (
            <button
              key={id}
              className={`tab${isCurrent ? ' active' : ''}`}
              onClick={() => setTab(id)}
            >
              <span className="tab-icon">{icon}</span>
              {label}
              {hasBadge && (
                <span
                  className={`pill ${validation.ok ? 'info' : 'warn'}`}
                  style={{ marginLeft: 4, padding: '1px 5px', fontSize: 8.5 }}
                >
                  {issueCount}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="code-monaco">
        {tab === 'code' && (
          <Monaco
            defaultLanguage="typescript"
            value={code}
            theme="vs-dark"
            height="100%"
            options={{
              readOnly: true,
              fontSize: 11.5,
              fontFamily: '"JetBrains Mono", "Fira Code", ui-monospace, monospace',
              fontLigatures: true,
              minimap: { enabled: false },
              wordWrap: 'off',
              scrollBeyondLastLine: false,
              lineNumbers: 'on',
              renderLineHighlight: 'gutter',
              scrollbar: { verticalScrollbarSize: 3, horizontalScrollbarSize: 3 },
              padding: { top: 14, bottom: 14 },
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
            }}
          />
        )}
        {tab === 'graph' && (
          <Monaco
            defaultLanguage="json"
            value={graphJson}
            theme="vs-dark"
            height="100%"
            options={{
              readOnly: true,
              fontSize: 11,
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              scrollbar: { verticalScrollbarSize: 3, horizontalScrollbarSize: 3 },
              padding: { top: 14, bottom: 14 },
              overviewRulerBorder: false,
            }}
          />
        )}
        {tab === 'issues' && <IssuesList issues={validation.issues} />}
      </div>
    </div>
  );
}

function IssuesList({ issues }: { issues: ValidationIssue[] }) {
  if (issues.length === 0) {
    return (
      <div className="validation-ok">
        <div className="vok-icon">✅</div>
        <div className="vok-title">Graph is valid</div>
        <div className="vok-sub">No errors or warnings — ready to deploy</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 5 }}>
      {issues.map((issue, i) => (
        <div key={i} className={`issue ${issue.severity}`}>
          <span className="issue-icon">{issue.severity === 'error' ? '❌' : '⚠️'}</span>
          <div>
            <div className="issue-text">{issue.message}</div>
            {(issue.nodeId ?? issue.edgeId) && (
              <div className="issue-loc">
                {issue.nodeId && `node: ${issue.nodeId}`}
                {issue.edgeId && `edge: ${issue.edgeId}`}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
