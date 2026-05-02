'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { useStudioStore } from '../lib/store';
import { generateCode } from '../lib/codegen';
import { validateGraph, type ValidationIssue } from '../lib/validator';

const Monaco = dynamic(() => import('@monaco-editor/react').then((m) => m.default), {
  ssr: false,
  loading: () => <div className="empty">Loading Monaco…</div>,
});

type Tab = 'code' | 'graph' | 'issues';

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

  return (
    <div className="code-panel">
      <div className="code-tabs">
        <button className={`tab${tab === 'code' ? ' active' : ''}`} onClick={() => setTab('code')}>
          generated code
        </button>
        <button
          className={`tab${tab === 'graph' ? ' active' : ''}`}
          onClick={() => setTab('graph')}
        >
          graph JSON
        </button>
        <button
          className={`tab${tab === 'issues' ? ' active' : ''}`}
          onClick={() => setTab('issues')}
          aria-label={`${validation.issues.length} issues`}
        >
          issues{' '}
          {validation.issues.length > 0 && (
            <span className={`pill ${validation.ok ? 'info' : 'warn'}`}>
              {validation.issues.length}
            </span>
          )}
        </button>
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
              fontSize: 12,
              minimap: { enabled: false },
              wordWrap: 'off',
              scrollBeyondLastLine: false,
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
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
            }}
          />
        )}
        {tab === 'issues' && <IssuesList issues={validation.issues} />}
      </div>
    </div>
  );
}

function IssuesList({ issues }: { issues: ValidationIssue[] }): JSX.Element {
  if (issues.length === 0) {
    return <div className="empty">No issues. Graph is ready to deploy.</div>;
  }
  return (
    <div className="inspector">
      <div className="issues">
        {issues.map((i, idx) => (
          <div key={idx} className={`issue ${i.severity}`}>
            <strong>{i.severity.toUpperCase()}</strong>: {i.message}
            {i.nodeId && <> (node: {i.nodeId})</>}
            {i.edgeId && <> (edge: {i.edgeId})</>}
          </div>
        ))}
      </div>
    </div>
  );
}
