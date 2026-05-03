/**
 * Mesh — coordination surface for multi-agent flows.
 *
 * Holds a Bus + a name→Agent registry. Patterns consume the registry and
 * emit events through the bus. The Mesh class itself is intentionally
 * light; semantic policies (plan/execute/critique, debate, hierarchical)
 * live in `src/patterns/*`.
 *
 * v0.2.0 (Phase B PR2): adds the unified `MeshEvent` surface — a separate,
 * ephemeral pub/sub channel on top of the durable Bus. The orchestrator
 * subscribes via `mesh.onEvent(handler)`. When an agent runs (whether
 * called directly OR via `mesh.dispatch()`), its core-level events are
 * translated into MeshEvents and broadcast to all subscribers. taskId is
 * threaded via AsyncLocalStorage so subscribers can filter by task.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { Agent } from '@sovereignclaw/core';
import { Bus, type BusEventHandler, type BusOptions } from './bus.js';
import { MeshClosedError } from './errors.js';
import type { MeshEvent, MeshEventHandler } from './mesh-events.js';

/** Single-writer Mesh instance. */
export interface MeshOptions extends Omit<BusOptions, 'meshId'> {
  meshId: string;
}

interface TaskContext {
  taskId: string;
  /** The role of the agent most recently observed running. Used to detect
   *  handoffs between agents within the same task. Mutable so the same
   *  context object is updated as the task progresses through agents. */
  lastAgentRole: string | null;
}

export class Mesh {
  readonly meshId: string;
  readonly bus: Bus;
  private readonly agents = new Map<string, Agent>();
  /** Cleanup functions installed when an agent registers — pulled when the
   *  mesh closes so registered agents don't keep emitting into us. */
  private readonly agentDetach = new Map<string, () => void>();
  private readonly meshEventHandlers = new Set<MeshEventHandler>();
  private readonly taskCtx = new AsyncLocalStorage<TaskContext>();
  private closed = false;

  constructor(options: MeshOptions) {
    this.meshId = options.meshId;
    this.bus = new Bus({
      meshId: options.meshId,
      provider: options.provider,
      initialSeq: options.initialSeq,
    });
  }

  private assertOpen(): void {
    if (this.closed) throw new MeshClosedError(this.meshId);
  }

  /**
   * Register an agent under its role (or an explicit alias). Later patterns
   * reference agents by this string. Hooks the agent's typed event surface
   * so its `agent.thinking.*` / `agent.action.*` / `agent.outcome` emissions
   * surface as MeshEvents on this mesh's `onEvent` channel.
   */
  register(agent: Agent, alias?: string): this {
    this.assertOpen();
    const name = alias ?? agent.role;
    this.agents.set(name, agent);
    const detach = this.attachAgentEvents(agent);
    this.agentDetach.set(name, detach);
    return this;
  }

  /** Lookup a registered agent by role or alias. Returns undefined if unknown. */
  get(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  /** All registered agents, in insertion order. Handy for hierarchical patterns. */
  listAgents(): Array<{ name: string; agent: Agent }> {
    return Array.from(this.agents.entries()).map(([name, agent]) => ({ name, agent }));
  }

  /** Subscribe to every bus event. Returns an unsubscribe handle.
   *
   *  This is the durable-bus subscription. For the streaming MeshEvent
   *  surface (the one IncomeClaw consumes), use `onEvent` instead. */
  on(handler: BusEventHandler): () => void {
    this.assertOpen();
    return this.bus.on(handler);
  }

  /**
   * Subscribe to the unified `MeshEvent` surface. Handler is invoked
   * synchronously, in production order; subscriber errors are swallowed
   * (so a buggy listener can't take down a sibling). No buffering, no
   * backpressure — subscribers that disconnect miss whatever fires while
   * they are gone. The durable bus is the replay layer; this surface is
   * ephemeral by design (see docs/streaming.md).
   *
   * Returns an unsubscribe function.
   */
  onEvent(handler: MeshEventHandler): () => void {
    this.assertOpen();
    this.meshEventHandlers.add(handler);
    return () => {
      this.meshEventHandlers.delete(handler);
    };
  }

  /**
   * Dispatch a task to an injected pattern. Generates a taskId, opens an
   * AsyncLocalStorage context so registered agents' events get tagged with
   * it, emits `task.created` before the pattern starts, and either
   * `task.complete` or `task.error` after.
   *
   * The pattern receives `(this, input)`. Returning a string sets the
   * `task.complete.finalOutput`; returning an object whose `.finalOutput`
   * is a string uses that; otherwise the result is JSON-stringified.
   */
  async dispatch<R>(
    input: string,
    pattern: (mesh: Mesh, input: string) => Promise<R>,
  ): Promise<R> {
    this.assertOpen();
    const taskId = randomUUID();

    return await this.taskCtx.run({ taskId, lastAgentRole: null }, async () => {
      this.emitMeshEvent({ type: 'task.created', taskId, input });
      try {
        const result = await pattern(this, input);
        const finalOutput =
          typeof result === 'string'
            ? result
            : typeof (result as { finalOutput?: unknown })?.finalOutput === 'string'
              ? (result as { finalOutput: string }).finalOutput
              : JSON.stringify(result);
        this.emitMeshEvent({ type: 'task.complete', taskId, finalOutput });
        return result;
      } catch (err) {
        const e = err as Error;
        this.emitMeshEvent({
          type: 'task.error',
          taskId,
          error: { name: e?.name ?? 'Error', message: e?.message ?? String(err) },
        });
        throw err;
      }
    });
  }

  /**
   * Close mesh: unregisters agents and closes the underlying Bus/provider.
   * Does not close registered Agents; callers own their lifetimes.
   */
  async close(): Promise<void> {
    this.closed = true;
    for (const detach of this.agentDetach.values()) {
      try {
        detach();
      } catch {
        // detach must never throw; defensive
      }
    }
    this.agentDetach.clear();
    this.agents.clear();
    this.meshEventHandlers.clear();
    await this.bus.close();
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private emitMeshEvent(event: MeshEvent): void {
    for (const handler of this.meshEventHandlers) {
      try {
        handler(event);
      } catch {
        // Subscriber errors must not abort sibling subscribers or the
        // emitting code path. Swallow; subscribers own their own try/catch.
      }
    }
  }

  /**
   * Wire one agent's typed events to this mesh's `onEvent` surface. Each
   * handler reads the active task context from AsyncLocalStorage; if no
   * context is set (the agent ran outside `mesh.dispatch()`), the handler
   * exits without emitting.
   */
  private attachAgentEvents(agent: Agent): () => void {
    const onThinkingStart = (payload: { role: string; runId: string }): void => {
      const ctx = this.taskCtx.getStore();
      if (!ctx) return;
      // Detect handoff: same task, but a different agent has taken the floor.
      if (ctx.lastAgentRole !== null && ctx.lastAgentRole !== payload.role) {
        this.emitMeshEvent({
          type: 'agent.handoff',
          fromRole: ctx.lastAgentRole,
          toRole: payload.role,
          taskId: ctx.taskId,
        });
      }
      ctx.lastAgentRole = payload.role;
      this.emitMeshEvent({
        type: 'agent.thinking.start',
        agentRole: payload.role,
        taskId: ctx.taskId,
      });
    };
    const onThinkingToken = (payload: { role: string; runId: string; text: string }): void => {
      const ctx = this.taskCtx.getStore();
      if (!ctx) return;
      this.emitMeshEvent({
        type: 'agent.thinking.token',
        agentRole: payload.role,
        taskId: ctx.taskId,
        text: payload.text,
      });
    };
    const onThinkingEnd = (payload: { role: string; runId: string; fullText: string }): void => {
      const ctx = this.taskCtx.getStore();
      if (!ctx) return;
      this.emitMeshEvent({
        type: 'agent.thinking.end',
        agentRole: payload.role,
        taskId: ctx.taskId,
        fullText: payload.fullText,
      });
    };
    const onActionStart = (payload: {
      role: string;
      runId: string;
      tool: string;
      args: unknown;
    }): void => {
      const ctx = this.taskCtx.getStore();
      if (!ctx) return;
      this.emitMeshEvent({
        type: 'agent.action.start',
        agentRole: payload.role,
        taskId: ctx.taskId,
        tool: payload.tool,
        args: payload.args,
      });
    };
    const onActionEnd = (payload: {
      role: string;
      runId: string;
      tool: string;
      result: unknown;
      ms: number;
    }): void => {
      const ctx = this.taskCtx.getStore();
      if (!ctx) return;
      this.emitMeshEvent({
        type: 'agent.action.end',
        agentRole: payload.role,
        taskId: ctx.taskId,
        tool: payload.tool,
        result: payload.result,
        ms: payload.ms,
      });
    };
    const onOutcome = (payload: { role: string; runId: string; result: unknown }): void => {
      const ctx = this.taskCtx.getStore();
      if (!ctx) return;
      this.emitMeshEvent({
        type: 'agent.outcome',
        agentRole: payload.role,
        taskId: ctx.taskId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        result: payload.result as any,
      });
    };

    agent.on('agent.thinking.start', onThinkingStart);
    agent.on('agent.thinking.token', onThinkingToken);
    agent.on('agent.thinking.end', onThinkingEnd);
    agent.on('agent.action.start', onActionStart);
    agent.on('agent.action.end', onActionEnd);
    agent.on('agent.outcome', onOutcome);

    return () => {
      agent.off('agent.thinking.start', onThinkingStart);
      agent.off('agent.thinking.token', onThinkingToken);
      agent.off('agent.thinking.end', onThinkingEnd);
      agent.off('agent.action.start', onActionStart);
      agent.off('agent.action.end', onActionEnd);
      agent.off('agent.outcome', onOutcome);
    };
  }
}
