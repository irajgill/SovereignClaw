/**
 * Mesh — coordination surface for multi-agent flows.
 *
 * Holds a Bus + a name→Agent registry. Patterns consume the registry and
 * emit events through the bus. The Mesh class itself is intentionally
 * light; semantic policies (plan/execute/critique, debate, hierarchical)
 * live in `src/patterns/*`.
 */
import type { Agent } from '@sovereignclaw/core';
import { Bus, type BusEventHandler, type BusOptions } from './bus.js';
import { MeshClosedError } from './errors.js';

/** Single-writer Mesh instance. */
export interface MeshOptions extends Omit<BusOptions, 'meshId'> {
  meshId: string;
}

export class Mesh {
  readonly meshId: string;
  readonly bus: Bus;
  private readonly agents = new Map<string, Agent>();
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
   * reference agents by this string.
   */
  register(agent: Agent, alias?: string): this {
    this.assertOpen();
    const name = alias ?? agent.role;
    this.agents.set(name, agent);
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

  /** Subscribe to every bus event. Returns an unsubscribe handle. */
  on(handler: BusEventHandler): () => void {
    this.assertOpen();
    return this.bus.on(handler);
  }

  /**
   * Close mesh: unregisters agents and closes the underlying Bus/provider.
   * Does not close registered Agents; callers own their lifetimes.
   */
  async close(): Promise<void> {
    this.closed = true;
    this.agents.clear();
    await this.bus.close();
  }
}
