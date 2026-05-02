/**
 * Client + server shared graph validator for ClawStudio.
 *
 * Guarantees before codegen / deploy:
 *   - Node ids and edge ids are unique.
 *   - Every edge source/target references a real node.
 *   - Every Agent has at least an Inference wired.
 *   - Every Mesh has a planner, at least one executor, and a critic.
 *   - Agent roles are unique (we mint one iNFT per agent by role).
 *   - Required config fields on each node type are non-empty.
 *
 * Returns a `ValidationResult` — this is NOT an exception path. Studio
 * uses it to gate the Deploy button, and the backend also re-runs it
 * server-side to reject malformed graphs before spending gas.
 */
import type {
  AgentNodeData,
  EdgeRole,
  InferenceNodeData,
  MemoryNodeData,
  MeshNodeData,
  ReflectionNodeData,
  StudioEdge,
  StudioGraph,
  StudioNode,
  ToolNodeData,
} from './types.js';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}

export function validateGraph(graph: StudioGraph): ValidationResult {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set<string>();
  for (const n of graph.nodes) {
    if (nodeIds.has(n.id)) {
      issues.push({ severity: 'error', message: `duplicate node id '${n.id}'`, nodeId: n.id });
    }
    nodeIds.add(n.id);
    validateNodeData(n, issues);
  }

  const edgeIds = new Set<string>();
  for (const e of graph.edges) {
    if (edgeIds.has(e.id)) {
      issues.push({ severity: 'error', message: `duplicate edge id '${e.id}'`, edgeId: e.id });
    }
    edgeIds.add(e.id);
    if (!nodeIds.has(e.source)) {
      issues.push({
        severity: 'error',
        message: `edge source '${e.source}' does not exist`,
        edgeId: e.id,
      });
    }
    if (!nodeIds.has(e.target)) {
      issues.push({
        severity: 'error',
        message: `edge target '${e.target}' does not exist`,
        edgeId: e.id,
      });
    }
  }

  // Per-role wiring rules
  validateAgents(graph, issues);
  validateMeshes(graph, issues);

  // Unique agent roles
  const roles = new Map<string, string>();
  for (const n of graph.nodes) {
    if (n.data.kind !== 'agent') continue;
    const role = (n.data as AgentNodeData).role;
    const existing = roles.get(role);
    if (existing) {
      issues.push({
        severity: 'error',
        message: `duplicate agent role '${role}' (nodes ${existing} and ${n.id}); mint requires unique roles`,
        nodeId: n.id,
      });
    }
    roles.set(role, n.id);
  }

  return { ok: issues.every((i) => i.severity !== 'error'), issues };
}

function validateNodeData(n: StudioNode, issues: ValidationIssue[]): void {
  switch (n.data.kind) {
    case 'memory':
      requireString((n.data as MemoryNodeData).namespace, 'memory.namespace', n.id, issues);
      break;
    case 'inference':
      requireString((n.data as InferenceNodeData).model, 'inference.model', n.id, issues);
      break;
    case 'tool':
      requireString((n.data as ToolNodeData).toolName, 'tool.toolName', n.id, issues);
      break;
    case 'reflection': {
      const r = n.data as ReflectionNodeData;
      if (!Number.isInteger(r.rounds) || r.rounds < 1) {
        issues.push({
          severity: 'error',
          message: `reflection.rounds must be a positive integer`,
          nodeId: n.id,
        });
      }
      if (r.threshold < 0 || r.threshold > 1) {
        issues.push({
          severity: 'error',
          message: `reflection.threshold must be in [0,1]`,
          nodeId: n.id,
        });
      }
      break;
    }
    case 'agent': {
      const a = n.data as AgentNodeData;
      requireString(a.role, 'agent.role', n.id, issues);
      if (a.systemPrompt.trim().length === 0) {
        issues.push({
          severity: 'warning',
          message: `agent '${a.role}' has no systemPrompt`,
          nodeId: n.id,
        });
      }
      break;
    }
    case 'mesh': {
      const m = n.data as MeshNodeData;
      requireString(m.meshId, 'mesh.meshId', n.id, issues);
      requireString(m.task, 'mesh.task', n.id, issues);
      if (m.maxRounds < 1) {
        issues.push({
          severity: 'error',
          message: `mesh.maxRounds must be >= 1`,
          nodeId: n.id,
        });
      }
      if (m.acceptThreshold < 0 || m.acceptThreshold > 1) {
        issues.push({
          severity: 'error',
          message: `mesh.acceptThreshold must be in [0,1]`,
          nodeId: n.id,
        });
      }
      break;
    }
  }
}

function requireString(
  value: string | undefined,
  field: string,
  nodeId: string,
  issues: ValidationIssue[],
): void {
  if (!value || value.trim().length === 0) {
    issues.push({
      severity: 'error',
      message: `${field} is required`,
      nodeId,
    });
  }
}

function edgesTargeting(
  graph: StudioGraph,
  targetNode: StudioNode,
  edgeRole: EdgeRole,
): StudioEdge[] {
  return graph.edges.filter((e) => e.target === targetNode.id && e.edgeRole === edgeRole);
}

function validateAgents(graph: StudioGraph, issues: ValidationIssue[]): void {
  for (const n of graph.nodes) {
    if (n.data.kind !== 'agent') continue;
    const infer = edgesTargeting(graph, n, 'inference');
    if (infer.length === 0) {
      issues.push({
        severity: 'error',
        message: `agent '${(n.data as AgentNodeData).role}' has no Inference wired`,
        nodeId: n.id,
      });
    }
    if (infer.length > 1) {
      issues.push({
        severity: 'error',
        message: `agent '${(n.data as AgentNodeData).role}' has multiple Inference inputs; exactly one required`,
        nodeId: n.id,
      });
    }
    if (edgesTargeting(graph, n, 'memory').length > 1) {
      issues.push({
        severity: 'error',
        message: `agent has more than one Memory wired`,
        nodeId: n.id,
      });
    }
    if (edgesTargeting(graph, n, 'history').length > 1) {
      issues.push({
        severity: 'error',
        message: `agent has more than one History wired`,
        nodeId: n.id,
      });
    }
    if (edgesTargeting(graph, n, 'reflect').length > 1) {
      issues.push({
        severity: 'error',
        message: `agent has more than one Reflection wired`,
        nodeId: n.id,
      });
    }
  }
}

function validateMeshes(graph: StudioGraph, issues: ValidationIssue[]): void {
  for (const n of graph.nodes) {
    if (n.data.kind !== 'mesh') continue;
    const planners = edgesTargeting(graph, n, 'planner');
    const executors = edgesTargeting(graph, n, 'executor');
    const critics = edgesTargeting(graph, n, 'critic');
    if (planners.length !== 1) {
      issues.push({
        severity: 'error',
        message: `mesh needs exactly one planner (found ${planners.length})`,
        nodeId: n.id,
      });
    }
    if (executors.length < 1) {
      issues.push({
        severity: 'error',
        message: `mesh needs at least one executor`,
        nodeId: n.id,
      });
    }
    if (critics.length !== 1) {
      issues.push({
        severity: 'error',
        message: `mesh needs exactly one critic (found ${critics.length})`,
        nodeId: n.id,
      });
    }

    // Each of those edges' sources must be an Agent node.
    for (const e of [...planners, ...executors, ...critics]) {
      const src = graph.nodes.find((sn) => sn.id === e.source);
      if (!src) continue; // already caught above
      if (src.data.kind !== 'agent') {
        issues.push({
          severity: 'error',
          message: `mesh '${e.edgeRole}' input must come from an Agent node (got '${src.data.kind}')`,
          edgeId: e.id,
        });
      }
    }
  }
}
