import { describe, expect, it } from 'vitest';
import { validateGraph } from '../lib/validator.js';
import { seedGraph } from '../lib/seed-graph.js';
import type { StudioGraph } from '../lib/types.js';

function blankGraph(): StudioGraph {
  return { version: 1, nodes: [], edges: [] };
}

describe('validateGraph', () => {
  it('passes on the seed graph', () => {
    const { ok, issues } = validateGraph(seedGraph());
    expect(ok).toBe(true);
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('flags duplicate node ids', () => {
    const g = blankGraph();
    g.nodes.push(
      {
        id: 'n1',
        kind: 'memory',
        position: { x: 0, y: 0 },
        data: { kind: 'memory', namespace: 'a', encrypted: true },
      },
      {
        id: 'n1',
        kind: 'memory',
        position: { x: 0, y: 0 },
        data: { kind: 'memory', namespace: 'b', encrypted: true },
      },
    );
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('duplicate node id'))).toBe(true);
  });

  it('flags edges pointing at missing nodes', () => {
    const g = blankGraph();
    g.edges.push({ id: 'e1', source: 'ghost', target: 'also-ghost', edgeRole: 'inference' });
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("source 'ghost'"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("target 'also-ghost'"))).toBe(true);
  });

  it('flags an agent with no inference', () => {
    const g: StudioGraph = {
      version: 1,
      nodes: [
        {
          id: 'a',
          kind: 'agent',
          position: { x: 0, y: 0 },
          data: { kind: 'agent', role: 'r', systemPrompt: 'x' },
        },
      ],
      edges: [],
    };
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('no Inference wired'))).toBe(true);
  });

  it('flags duplicate agent roles', () => {
    const g = seedGraph();
    // Rename planner to "executor" → now two executors exist.
    const planner = g.nodes.find((n) => n.id === 'agent-planner')!;
    (planner.data as { role: string }).role = 'executor';
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("duplicate agent role 'executor'"))).toBe(true);
  });

  it('flags a mesh missing critic', () => {
    const g = seedGraph();
    g.edges = g.edges.filter((e) => e.edgeRole !== 'critic');
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('exactly one critic'))).toBe(true);
  });

  it('flags a mesh whose planner edge originates from a non-agent', () => {
    const g = seedGraph();
    const plannerEdge = g.edges.find((e) => e.edgeRole === 'planner')!;
    plannerEdge.source = 'mem-planner';
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('must come from an Agent node'))).toBe(true);
  });

  it('flags a reflection with invalid threshold', () => {
    const g: StudioGraph = {
      version: 1,
      nodes: [
        {
          id: 'r1',
          kind: 'reflection',
          position: { x: 0, y: 0 },
          data: {
            kind: 'reflection',
            rounds: 1,
            critic: 'self',
            rubric: 'accuracy',
            threshold: 2,
            persistLearnings: true,
          },
        },
      ],
      edges: [],
    };
    const r = validateGraph(g);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('threshold'))).toBe(true);
  });
});
