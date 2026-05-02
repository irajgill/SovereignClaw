'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import ReactFlow, {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  addEdge as rfAddEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node as RFNode,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from 'reactflow';
import { nodeTypes as baseNodeTypes } from './nodes/StudioNode';
import { useStudioStore, type CanvasEdge, type CanvasNode } from '../lib/store';
import type { EdgeRole, NodeKind, StudioNodeData } from '../lib/types';

const nodeTypes = baseNodeTypes as NodeTypes;

/**
 * Infer a sensible default edge role based on source/target kinds so
 * users don't have to pick one for the common case. Users can change it
 * later by selecting the edge and editing in the inspector (planned).
 */
function inferEdgeRole(sourceKind: NodeKind, targetKind: NodeKind): EdgeRole {
  if (sourceKind === 'memory' && targetKind === 'agent') return 'memory';
  if (sourceKind === 'inference' && targetKind === 'agent') return 'inference';
  if (sourceKind === 'reflection' && targetKind === 'agent') return 'reflect';
  if (sourceKind === 'tool' && targetKind === 'agent') return 'tool';
  if (sourceKind === 'agent' && targetKind === 'mesh') return 'executor';
  return 'inference';
}

export function Canvas(): JSX.Element {
  const { nodes, edges, setNodes, setEdges, addNode, setSelected } = useStudioStore();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const flowRef = useRef<ReactFlowInstance | null>(null);

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      setNodes(applyNodeChanges(changes, nodes as RFNode[]) as CanvasNode[]);
    },
    [nodes, setNodes],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges(applyEdgeChanges(changes, edges as Edge[]) as CanvasEdge[]);
    },
    [edges, setEdges],
  );

  const handleConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const src = nodes.find((n) => n.id === conn.source);
      const tgt = nodes.find((n) => n.id === conn.target);
      if (!src || !tgt) return;
      const role = inferEdgeRole(
        (src.data as StudioNodeData).kind,
        (tgt.data as StudioNodeData).kind,
      );
      const newEdge: CanvasEdge = {
        id: `edge-${Math.random().toString(36).slice(2, 8)}`,
        source: conn.source,
        target: conn.target,
        label: role,
        data: { edgeRole: role },
        markerEnd: { type: MarkerType.ArrowClosed, color: '#7c8398' },
      };
      setEdges(rfAddEdge(newEdge, edges as Edge[]) as CanvasEdge[]);
    },
    [nodes, edges, setEdges],
  );

  const handleDragOver = useCallback((evt: React.DragEvent) => {
    evt.preventDefault();
    evt.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDrop = useCallback(
    (evt: React.DragEvent) => {
      evt.preventDefault();
      const kind = evt.dataTransfer.getData('application/sc-node-kind') as NodeKind;
      if (!kind || !flowRef.current || !wrapperRef.current) return;
      const position = flowRef.current.screenToFlowPosition({
        x: evt.clientX,
        y: evt.clientY,
      });
      addNode(kind, position);
    },
    [addNode],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setSelected]);

  const styledEdges = useMemo(
    () =>
      edges.map((e) => ({
        ...e,
        markerEnd: e.markerEnd ?? { type: MarkerType.ArrowClosed, color: '#7c8398' },
      })),
    [edges],
  );

  return (
    <div ref={wrapperRef} className="canvas-wrap" onDragOver={handleDragOver} onDrop={handleDrop}>
      <ReactFlow
        nodes={nodes}
        edges={styledEdges as Edge[]}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onNodeClick={(_e, n) => setSelected(n.id)}
        onPaneClick={() => setSelected(null)}
        onInit={(inst) => {
          flowRef.current = inst;
        }}
        fitView
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#232a38" />
        <Controls position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          maskColor="rgba(11,14,20,0.55)"
          nodeStrokeColor={() => '#6ee7b7'}
          nodeColor={() => '#1a1f2b'}
        />
      </ReactFlow>
    </div>
  );
}
