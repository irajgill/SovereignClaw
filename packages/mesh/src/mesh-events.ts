/**
 * MeshEvent surface — Phase B PR2.
 *
 * The unified, in-process event surface that orchestrators (e.g. IncomeClaw)
 * subscribe to via `mesh.onEvent(...)`. Distinct from the durable 0G Log
 * bus (`mesh.bus`):
 *
 *   - the bus is durable, append-only, replayable; it survives restarts and
 *     is the source of truth for IncomeClaw's audit trail.
 *   - this surface is ephemeral, in-process, fire-and-forget. Subscribers
 *     who disconnect miss whatever fires while they are gone. It is what
 *     the streaming UI consumes.
 *
 * The MeshEvent union mirrors the agent-level events emitted by
 * @sovereignclaw/core@0.2.0, plus orchestrator-level wrappers (task.*,
 * agent.handoff). This is the only event vocabulary IncomeClaw needs to
 * understand.
 */
import type { InferenceResult } from '@sovereignclaw/core';

export type MeshEvent =
  | { type: 'agent.thinking.start'; agentRole: string; taskId: string }
  | { type: 'agent.thinking.token'; agentRole: string; taskId: string; text: string }
  | { type: 'agent.thinking.end'; agentRole: string; taskId: string; fullText: string }
  | { type: 'agent.action.start'; agentRole: string; taskId: string; tool: string; args: unknown }
  | {
      type: 'agent.action.end';
      agentRole: string;
      taskId: string;
      tool: string;
      result: unknown;
      ms: number;
    }
  | { type: 'agent.outcome'; agentRole: string; taskId: string; result: InferenceResult }
  | { type: 'agent.handoff'; fromRole: string; toRole: string; taskId: string }
  | { type: 'task.created'; taskId: string; input: string }
  | { type: 'task.complete'; taskId: string; finalOutput: string }
  | { type: 'task.error'; taskId: string; error: { name: string; message: string } };

export type MeshEventHandler = (event: MeshEvent) => void;

export type MeshEventType = MeshEvent['type'];
