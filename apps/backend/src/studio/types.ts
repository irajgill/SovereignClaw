/**
 * Shared Studio types between the client (packages/studio) and the
 * backend. We keep them duplicated here (rather than importing from the
 * Studio Next.js package) because:
 *   - `@sovereignclaw/backend` is a service, not a consumer of the
 *      Next.js package.
 *   - Copying keeps the backend compile-independent from the UI.
 *
 * The shape MUST stay in sync with `packages/studio/lib/types.ts`.
 * A structural test (in test/studio/parity.test.ts) guards against drift.
 */
import { z } from 'zod';

const memoryData = z.object({
  kind: z.literal('memory'),
  namespace: z.string().min(1),
  encrypted: z.boolean(),
});

const inferenceData = z.object({
  kind: z.literal('inference'),
  model: z.string().min(1),
  verifiable: z.boolean(),
  providerAddress: z.string().optional(),
});

const toolData = z.object({
  kind: z.literal('tool'),
  toolName: z.string().min(1),
  toolKind: z.enum(['http', 'onchain', 'file']),
  config: z.record(z.string()),
});

const customRubric = z.object({
  kind: z.literal('custom'),
  name: z.string().min(1),
  description: z.string().min(1),
  criteria: z.string().min(1),
});

const reflectionData = z.object({
  kind: z.literal('reflection'),
  rounds: z.number().int().positive(),
  critic: z.enum(['self', 'peer']),
  rubric: z.union([z.enum(['accuracy', 'completeness', 'safety', 'concision']), customRubric]),
  threshold: z.number().min(0).max(1),
  persistLearnings: z.boolean(),
});

const agentData = z.object({
  kind: z.literal('agent'),
  role: z.string().min(1),
  systemPrompt: z.string(),
});

const meshData = z.object({
  kind: z.literal('mesh'),
  meshId: z.string().min(1),
  pattern: z.literal('planExecuteCritique'),
  task: z.string().min(1),
  maxRounds: z.number().int().positive(),
  acceptThreshold: z.number().min(0).max(1),
});

const nodeData = z.discriminatedUnion('kind', [
  memoryData,
  inferenceData,
  toolData,
  reflectionData,
  agentData,
  meshData,
]);

export const studioNode = z.object({
  id: z.string().min(1),
  kind: z.enum(['memory', 'inference', 'tool', 'reflection', 'agent', 'mesh']),
  position: z.object({ x: z.number(), y: z.number() }),
  data: nodeData,
});

export const studioEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  edgeRole: z.enum([
    'memory',
    'history',
    'inference',
    'tool',
    'reflect',
    'planner',
    'executor',
    'critic',
  ]),
});

export const studioGraph = z.object({
  version: z.literal(1),
  nodes: z.array(studioNode),
  edges: z.array(studioEdge),
});

export const studioDeployClaim = z.object({
  graphSha: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  timestamp: z.number().int().nonnegative(),
});

export const signedStudioDeployClaim = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/),
  claim: studioDeployClaim,
});

export const deployRequest = z.object({
  graph: studioGraph,
  code: z.string().min(1).max(500_000),
  clientSig: signedStudioDeployClaim.optional(),
});

export type StudioGraph = z.infer<typeof studioGraph>;
export type StudioNode = z.infer<typeof studioNode>;
export type StudioEdge = z.infer<typeof studioEdge>;
export type DeployRequest = z.infer<typeof deployRequest>;
export type StudioDeployClaim = z.infer<typeof studioDeployClaim>;
export type SignedStudioDeployClaim = z.infer<typeof signedStudioDeployClaim>;
