import { describe, expect, it } from 'vitest';
import { generateCode } from '../lib/codegen.js';
import { seedGraph } from '../lib/seed-graph.js';
import { validateGraph } from '../lib/validator.js';
import type { StudioGraph } from '../lib/types.js';

describe('generateCode (pure function, snapshot-stable)', () => {
  it('validates the seed graph cleanly', () => {
    const result = validateGraph(seedGraph());
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('is deterministic: same graph → same source, byte-for-byte', () => {
    const g = seedGraph();
    const a = generateCode(g).source;
    const b = generateCode(g).source;
    expect(a).toBe(b);
  });

  it('emits a runnable main() entrypoint for the seed graph', () => {
    const { source, imports } = generateCode(seedGraph());
    // Core imports appear
    expect(imports['@sovereignclaw/core']).toContain('Agent');
    expect(imports['@sovereignclaw/core']).toContain('sealed0GInference');
    expect(imports['@sovereignclaw/memory']).toContain('OG_Log');
    expect(imports['@sovereignclaw/memory']).toContain('encrypted');
    expect(imports['@sovereignclaw/memory']).toContain('deriveKekFromSigner');
    expect(imports['@sovereignclaw/mesh']).toContain('Mesh');
    expect(imports['@sovereignclaw/mesh']).toContain('planExecuteCritique');

    // Structural assertions without being brittle about formatting.
    expect(source).toMatch(/async function main\(\)/);
    expect(source).toMatch(/new Agent\(\{[\s\S]+role: "planner"/);
    expect(source).toMatch(/new Agent\(\{[\s\S]+role: "executor"/);
    expect(source).toMatch(/new Agent\(\{[\s\S]+role: "critic"/);
    expect(source).toMatch(/planExecuteCritique\(\{/);
    expect(source).toMatch(/main\(\)\.catch\(/);

    // Three encrypted memories wired.
    expect((source.match(/encrypted\(OG_Log/g) ?? []).length).toBe(3);
    // Three inference adapters.
    expect((source.match(/sealed0GInference\(\{/g) ?? []).length).toBe(3);
  });

  it('snapshots the seed graph output', () => {
    const { source } = generateCode(seedGraph());
    expect(source).toMatchSnapshot();
  });

  it('single-agent minimal graph emits agent.run() with a default prompt', () => {
    const minimal: StudioGraph = {
      version: 1,
      nodes: [
        {
          id: 'inf-1',
          kind: 'inference',
          position: { x: 0, y: 0 },
          data: { kind: 'inference', model: 'qwen/qwen-2.5-7b-instruct', verifiable: true },
        },
        {
          id: 'agent-1',
          kind: 'agent',
          position: { x: 100, y: 0 },
          data: { kind: 'agent', role: 'solo', systemPrompt: 'You are helpful.' },
        },
      ],
      edges: [{ id: 'e1', source: 'inf-1', target: 'agent-1', edgeRole: 'inference' }],
    };
    const { source } = generateCode(minimal);
    expect(source).toMatch(/agent_agent_1\.run/);
    expect(source).toMatch(/agent_agent_1\.close/);
    // No Mesh import when no mesh node.
    expect(source).not.toMatch(/@sovereignclaw\/mesh/);
  });

  it('includes reflectOnOutput when a reflection node is wired', () => {
    const g: StudioGraph = {
      version: 1,
      nodes: [
        {
          id: 'inf-1',
          kind: 'inference',
          position: { x: 0, y: 0 },
          data: { kind: 'inference', model: 'qwen/qwen-2.5-7b-instruct', verifiable: true },
        },
        {
          id: 'refl-1',
          kind: 'reflection',
          position: { x: 0, y: 100 },
          data: {
            kind: 'reflection',
            rounds: 1,
            critic: 'self',
            rubric: 'accuracy',
            threshold: 0.7,
            persistLearnings: true,
          },
        },
        {
          id: 'agent-1',
          kind: 'agent',
          position: { x: 100, y: 0 },
          data: { kind: 'agent', role: 'r', systemPrompt: 'x' },
        },
      ],
      edges: [
        { id: 'e1', source: 'inf-1', target: 'agent-1', edgeRole: 'inference' },
        { id: 'e2', source: 'refl-1', target: 'agent-1', edgeRole: 'reflect' },
      ],
    };
    const { source, imports } = generateCode(g);
    expect(imports['@sovereignclaw/reflection']).toContain('reflectOnOutput');
    expect(source).toMatch(/reflectOnOutput\(\{/);
    expect(source).toMatch(/reflect: reflect_refl_1/);
  });

  it('flags missing inference wiring in a comment, not a crash', () => {
    const broken: StudioGraph = {
      version: 1,
      nodes: [
        {
          id: 'agent-1',
          kind: 'agent',
          position: { x: 0, y: 0 },
          data: { kind: 'agent', role: 'r', systemPrompt: 'x' },
        },
      ],
      edges: [],
    };
    const { source } = generateCode(broken);
    expect(source).toMatch(/TODO.*missing inference wiring/);
  });
});
