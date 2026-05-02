/**
 * @sovereignclaw/mesh - multi-agent coordination over a 0G Log bus.
 *
 * Public exports as of Phase 5 v0:
 *   - Bus: thin append-only log wrapping a MemoryProvider
 *   - Mesh: Bus + agent registry
 *   - planExecuteCritique: the default 3-role pattern
 *   - BusEvent types + well-known BusEventTypes
 *   - Typed errors
 *
 * Patterns deferred to Phase 5.1: debate, hierarchical. See `docs/dev-log.md`.
 */
export const VERSION = '0.0.0';

export { Bus, type BusEventHandler, type BusOptions } from './bus.js';
export { Mesh, type MeshOptions } from './mesh.js';

export {
  planExecuteCritique,
  type PlanExecuteCritiqueOptions,
} from './patterns/plan-execute-critique.js';

export {
  BusEventTypes,
  type BusAppendResult,
  type BusEvent,
  type BusEventType,
  type CritiqueCreatedPayload,
  type ExecutionCompletePayload,
  type ExecutionStartedPayload,
  type PlanCreatedPayload,
  type PlanExecuteCritiqueResult,
  type TaskCompletePayload,
  type TaskCreatedPayload,
} from './types.js';

export { EVENT_KEY_PREFIX, SEQ_KEY_WIDTH, SeqCounter, eventKey, seqFromKey } from './seq.js';

export {
  BusAppendError,
  BusReplayError,
  CritiqueParseError,
  EmptyAgentOutputError,
  MaxRoundsExceededError,
  MeshClosedError,
  MeshError,
  PatternError,
} from './errors.js';
