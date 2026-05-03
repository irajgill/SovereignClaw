/**
 * Wire types for the ClawStudio graph.
 *
 * The same `StudioGraph` JSON flows:
 *   - from the canvas store → `generateCode(graph)` (browser) → Monaco preview
 *   - from the browser → POST /studio/deploy (backend) → esbuild → mint
 *
 * Keeping the shape strict on both sides means the codegen is a pure
 * function of this type (spec §11.3) and the backend can rebuild the same
 * string deterministically for audit.
 */

export type NodeKind = 'memory' | 'inference' | 'tool' | 'reflection' | 'agent' | 'mesh';

export interface MemoryNodeData {
  kind: 'memory';
  namespace: string;
  encrypted: boolean;
}

export interface InferenceNodeData {
  kind: 'inference';
  model: string;
  verifiable: boolean;
  providerAddress?: string;
}

export type ToolKind = 'http' | 'onchain' | 'file';

export interface ToolNodeData {
  kind: 'tool';
  toolName: string;
  toolKind: ToolKind;
  config: Record<string, string>;
}

export type BuiltInReflectionRubric = 'accuracy' | 'completeness' | 'safety' | 'concision';

/**
 * Custom rubric spec. When `kind === 'custom'`, the codegen emits a
 * `rubric: { name, description, criteria }` object that
 * `reflectOnOutput(...)` passes straight through to the critic.
 *
 * All three fields are free text. We do NOT try to validate
 * `criteria` beyond rejecting an empty string — the whole point of a
 * custom rubric is that the user defines the grading policy.
 */
export interface CustomReflectionRubric {
  kind: 'custom';
  name: string;
  description: string;
  criteria: string;
}

export type ReflectionRubric = BuiltInReflectionRubric | CustomReflectionRubric;

export interface ReflectionNodeData {
  kind: 'reflection';
  rounds: number;
  critic: 'self' | 'peer';
  rubric: ReflectionRubric;
  threshold: number;
  persistLearnings: boolean;
}

export interface AgentNodeData {
  kind: 'agent';
  role: string;
  systemPrompt: string;
}

export type MeshPattern = 'planExecuteCritique';

export interface MeshNodeData {
  kind: 'mesh';
  meshId: string;
  pattern: MeshPattern;
  task: string;
  maxRounds: number;
  acceptThreshold: number;
}

export type StudioNodeData =
  | MemoryNodeData
  | InferenceNodeData
  | ToolNodeData
  | ReflectionNodeData
  | AgentNodeData
  | MeshNodeData;

export interface StudioNode {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  data: StudioNodeData;
}

/**
 * Edges carry a `role` that identifies WHICH slot on the target node the
 * source fills. e.g. memory → agent:memory, inference → agent:inference,
 * reflection → agent:reflect, agent → mesh:executor, etc.
 */
export type EdgeRole =
  | 'memory'
  | 'history'
  | 'inference'
  | 'tool'
  | 'reflect'
  | 'planner'
  | 'executor'
  | 'critic';

export interface StudioEdge {
  id: string;
  source: string;
  target: string;
  edgeRole: EdgeRole;
}

export interface StudioGraph {
  version: 1;
  nodes: StudioNode[];
  edges: StudioEdge[];
}

export interface DeployManifest {
  version: 1;
  meshId: string;
  generatedAt: number;
  graph: StudioGraph;
  agents: Array<{ nodeId: string; role: string }>;
}
