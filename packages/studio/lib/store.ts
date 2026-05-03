/**
 * Zustand store for the Studio canvas.
 *
 * Keeps the React Flow nodes/edges in sync with the `StudioGraph` we hand
 * off to codegen and deploy. The public store API is intentionally small:
 *   - `nodes`, `edges` — React Flow state
 *   - `selectedId` — currently selected node (drives the inspector panel)
 *   - `setPosition`, `patchNodeData`, `addNode`, `removeNode`
 *   - `setEdges` (for React Flow internals)
 *   - `asGraph()` — flatten to a `StudioGraph`
 *   - `reset(graph)` — hydrate from a canonical StudioGraph
 */
'use client';

import { create } from 'zustand';
import type { Edge, Node as RFNode } from 'reactflow';
import type {
  EdgeRole,
  NodeKind,
  StudioEdge,
  StudioGraph,
  StudioNode,
  StudioNodeData,
} from './types.js';

export type CanvasNode = RFNode<StudioNodeData>;
export type CanvasEdge = Edge & { data?: { edgeRole: EdgeRole } };

/**
 * Snapshot of a wallet connection. The `provider` is not stored here —
 * it's kept live in the component that called `connect()` and passed
 * explicitly into `signDeploy` when needed. Keeping the store
 * serialisable + free of BrowserProvider lets React devtools render it
 * cleanly.
 */
export interface WalletState {
  address: string;
  chainId: number;
}

interface StudioStoreState {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedId: string | null;
  wallet: WalletState | null;

  setNodes(nodes: CanvasNode[]): void;
  setEdges(edges: CanvasEdge[]): void;
  setSelected(id: string | null): void;
  setWallet(w: WalletState | null): void;

  addNode(kind: NodeKind, position: { x: number; y: number }): void;
  removeNode(id: string): void;
  patchNodeData(id: string, patch: Partial<StudioNodeData>): void;
  addEdge(params: { source: string; target: string; edgeRole: EdgeRole }): void;
  removeEdge(id: string): void;

  asGraph(): StudioGraph;
  reset(graph: StudioGraph): void;
}

function defaultDataForKind(kind: NodeKind): StudioNodeData {
  switch (kind) {
    case 'memory':
      return { kind: 'memory', namespace: 'ns-new', encrypted: true };
    case 'inference':
      return { kind: 'inference', model: 'qwen/qwen-2.5-7b-instruct', verifiable: true };
    case 'tool':
      return { kind: 'tool', toolName: 'http-fetch', toolKind: 'http', config: {} };
    case 'reflection':
      return {
        kind: 'reflection',
        rounds: 1,
        critic: 'self',
        rubric: 'accuracy',
        threshold: 0.7,
        persistLearnings: true,
      };
    case 'agent':
      return { kind: 'agent', role: 'new-agent', systemPrompt: 'You are a helpful agent.' };
    case 'mesh':
      return {
        kind: 'mesh',
        meshId: `mesh-${Date.now().toString(36)}`,
        pattern: 'planExecuteCritique',
        task: 'Describe your task here.',
        maxRounds: 2,
        acceptThreshold: 0.7,
      };
  }
}

function canvasNode(n: StudioNode): CanvasNode {
  return {
    id: n.id,
    type: n.kind,
    position: n.position,
    data: n.data,
  };
}

function canvasEdge(e: StudioEdge): CanvasEdge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    label: e.edgeRole,
    data: { edgeRole: e.edgeRole },
    animated: false,
  };
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useStudioStore = create<StudioStoreState>((set, get) => ({
  nodes: [],
  edges: [],
  selectedId: null,
  wallet: null,

  setNodes(nodes): void {
    set({ nodes });
  },
  setEdges(edges): void {
    set({ edges });
  },
  setSelected(id): void {
    set({ selectedId: id });
  },
  setWallet(wallet): void {
    set({ wallet });
  },

  addNode(kind, position): void {
    const id = uid(kind);
    const data = defaultDataForKind(kind);
    const node: CanvasNode = { id, type: kind, position, data };
    set({ nodes: [...get().nodes, node], selectedId: id });
  },

  removeNode(id): void {
    set({
      nodes: get().nodes.filter((n) => n.id !== id),
      edges: get().edges.filter((e) => e.source !== id && e.target !== id),
      selectedId: get().selectedId === id ? null : get().selectedId,
    });
  },

  patchNodeData(id, patch): void {
    set({
      nodes: get().nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } as StudioNodeData } : n,
      ),
    });
  },

  addEdge({ source, target, edgeRole }): void {
    const id = uid('edge');
    const edge: CanvasEdge = {
      id,
      source,
      target,
      label: edgeRole,
      data: { edgeRole },
    };
    set({ edges: [...get().edges, edge] });
  },

  removeEdge(id): void {
    set({ edges: get().edges.filter((e) => e.id !== id) });
  },

  asGraph(): StudioGraph {
    const { nodes, edges } = get();
    return {
      version: 1,
      nodes: nodes.map((n) => ({
        id: n.id,
        kind: (n.type as NodeKind) ?? 'memory',
        position: n.position,
        data: n.data,
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        edgeRole: (e.data?.edgeRole ?? 'inference') as EdgeRole,
      })),
    };
  },

  reset(graph): void {
    set({
      nodes: graph.nodes.map(canvasNode),
      edges: graph.edges.map(canvasEdge),
      selectedId: null,
    });
  },
}));
