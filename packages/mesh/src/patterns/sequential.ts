/**
 * sequentialPattern — the simplest multi-agent pattern.
 *
 * Walks a list of agent names in order, feeding each agent the previous
 * agent's output as its input. Returns the final agent's output. Used by
 * the Phase B PR2 mesh-events tests as the minimal harness for asserting
 * MeshEvent ordering across agents (handoff, agent.thinking.*, etc.).
 *
 * Useful for IncomeClaw too — Brain → Strategist → Opener as a fallback
 * when the planner-executor-critic loop is overkill.
 */
import type { Mesh } from '../mesh.js';
import { EmptyAgentOutputError } from '../errors.js';

export interface SequentialOptions {
  /** Names of registered agents to run, in order. */
  agentNames: string[];
  /** When true, each agent receives a small JSON envelope with `{ task, prior }`
   *  instead of raw text. Default false (raw concatenation). */
  envelope?: boolean;
}

export function sequentialPattern(opts: SequentialOptions) {
  return async (mesh: Mesh, input: string): Promise<{ finalOutput: string; rounds: number }> => {
    let current = input;
    let rounds = 0;
    for (const name of opts.agentNames) {
      const agent = mesh.get(name);
      if (!agent) {
        throw new Error(
          `sequentialPattern: agent '${name}' not registered on mesh '${mesh.meshId}'`,
        );
      }
      const prompt = opts.envelope
        ? JSON.stringify({ task: input, prior: current })
        : current;
      const out = await agent.run(prompt);
      if (!out || !out.text) {
        throw new EmptyAgentOutputError(agent.role, `sequential[step=${rounds + 1}]`);
      }
      current = out.text;
      rounds += 1;
    }
    return { finalOutput: current, rounds };
  };
}
