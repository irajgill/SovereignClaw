/**
 * Pre-seeded Studio graph: the 3-agent research swarm from spec §11 cut-line.
 *
 * Rendered on first load so a reviewer can open ClawStudio and
 * immediately press Deploy without dragging a single node.
 *
 * Layout uses a left-to-right flow:
 *   Inference ─┐
 *              ├── Planner ──┐
 *   Memory ────┘             │
 *                            ├── Mesh
 *   Inference ─┐             │
 *              ├── Executor ─┤
 *   Memory ────┘             │
 *                            │
 *   Inference ─┐             │
 *              ├── Critic ───┘
 *   Memory ────┘
 */
import type { StudioGraph } from './types.js';

export function seedGraph(): StudioGraph {
  const model = 'qwen/qwen-2.5-7b-instruct';

  return {
    version: 1,
    nodes: [
      // Shared inference adapter configs (one per agent).
      {
        id: 'inf-planner',
        kind: 'inference',
        position: { x: 20, y: 20 },
        data: { kind: 'inference', model, verifiable: true },
      },
      {
        id: 'inf-executor',
        kind: 'inference',
        position: { x: 20, y: 240 },
        data: { kind: 'inference', model, verifiable: true },
      },
      {
        id: 'inf-critic',
        kind: 'inference',
        position: { x: 20, y: 460 },
        data: { kind: 'inference', model, verifiable: true },
      },
      // Per-agent memory (encrypted OG_Log).
      {
        id: 'mem-planner',
        kind: 'memory',
        position: { x: 20, y: 120 },
        data: { kind: 'memory', namespace: 'studio-research-swarm-planner', encrypted: true },
      },
      {
        id: 'mem-executor',
        kind: 'memory',
        position: { x: 20, y: 340 },
        data: { kind: 'memory', namespace: 'studio-research-swarm-executor', encrypted: true },
      },
      {
        id: 'mem-critic',
        kind: 'memory',
        position: { x: 20, y: 560 },
        data: { kind: 'memory', namespace: 'studio-research-swarm-critic', encrypted: true },
      },
      // Three agents.
      {
        id: 'agent-planner',
        kind: 'agent',
        position: { x: 320, y: 70 },
        data: {
          kind: 'agent',
          role: 'planner',
          systemPrompt:
            'You decompose research questions into short, numbered plans. Each step is concrete and verifiable. Do not answer the question yourself — only plan.',
        },
      },
      {
        id: 'agent-executor',
        kind: 'agent',
        position: { x: 320, y: 290 },
        data: {
          kind: 'agent',
          role: 'executor',
          systemPrompt:
            'You are a careful researcher. Follow the plan step-by-step and produce a concise factual answer. Cite authors, years, and venue when relevant.',
        },
      },
      {
        id: 'agent-critic',
        kind: 'agent',
        position: { x: 320, y: 510 },
        data: {
          kind: 'agent',
          role: 'critic',
          systemPrompt:
            'You are a strict academic reviewer. Grade answers on factual accuracy against the rubric. Output a single-line JSON object only.',
        },
      },
      // Mesh orchestrator.
      {
        id: 'mesh-swarm',
        kind: 'mesh',
        position: { x: 640, y: 290 },
        data: {
          kind: 'mesh',
          meshId: 'studio-research-swarm-v1',
          pattern: 'planExecuteCritique',
          task: 'Name the 2017 paper that introduced the Transformer architecture, its first author, and its venue. One sentence per field.',
          maxRounds: 2,
          acceptThreshold: 0.7,
        },
      },
    ],
    edges: [
      // Inference → each agent.
      {
        id: 'e-inf-planner',
        source: 'inf-planner',
        target: 'agent-planner',
        edgeRole: 'inference',
      },
      {
        id: 'e-inf-executor',
        source: 'inf-executor',
        target: 'agent-executor',
        edgeRole: 'inference',
      },
      { id: 'e-inf-critic', source: 'inf-critic', target: 'agent-critic', edgeRole: 'inference' },
      // Memory → each agent.
      { id: 'e-mem-planner', source: 'mem-planner', target: 'agent-planner', edgeRole: 'memory' },
      {
        id: 'e-mem-executor',
        source: 'mem-executor',
        target: 'agent-executor',
        edgeRole: 'memory',
      },
      { id: 'e-mem-critic', source: 'mem-critic', target: 'agent-critic', edgeRole: 'memory' },
      // Agents → mesh.
      { id: 'e-mesh-planner', source: 'agent-planner', target: 'mesh-swarm', edgeRole: 'planner' },
      {
        id: 'e-mesh-executor',
        source: 'agent-executor',
        target: 'mesh-swarm',
        edgeRole: 'executor',
      },
      { id: 'e-mesh-critic', source: 'agent-critic', target: 'mesh-swarm', edgeRole: 'critic' },
    ],
  };
}
