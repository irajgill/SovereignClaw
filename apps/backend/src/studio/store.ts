/**
 * In-memory store for Studio deploy jobs.
 *
 * Hackathon scope per spec §11.4 step 6d: a production registry would
 * persist to a database; here we keep a Map keyed by `deployId` and a
 * rotating history. Restarting the backend loses the history — that's
 * fine for v0 because the on-chain iNFTs are the durable truth.
 */
import { randomUUID } from 'node:crypto';

export type DeployPhase =
  | 'queued'
  | 'validating'
  | 'bundling'
  | 'writing-manifest'
  | 'minting'
  | 'done'
  | 'error';

export interface DeployAgentRecord {
  nodeId: string;
  role: string;
  tokenId?: string;
  txHash?: string;
  explorerUrl?: string;
}

export interface DeployLog {
  at: number;
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface DeployJob {
  deployId: string;
  status: DeployPhase;
  startedAt: number;
  finishedAt?: number;
  error?: string;
  manifestRoot?: string;
  storageExplorerUrl?: string;
  agents: DeployAgentRecord[];
  logs: DeployLog[];
  graphSha: string;
}

export interface DeployStore {
  create(graphSha: string): DeployJob;
  get(id: string): DeployJob | undefined;
  update(id: string, patch: Partial<Omit<DeployJob, 'deployId' | 'startedAt'>>): DeployJob;
  setAgent(id: string, agent: DeployAgentRecord): DeployJob;
  log(id: string, level: DeployLog['level'], message: string): DeployJob;
  size(): number;
}

export function createStudioStore(maxJobs = 128): DeployStore {
  const jobs = new Map<string, DeployJob>();
  const order: string[] = [];

  const evict = (): void => {
    while (order.length > maxJobs) {
      const oldest = order.shift();
      if (oldest) jobs.delete(oldest);
    }
  };

  const require = (id: string): DeployJob => {
    const j = jobs.get(id);
    if (!j) throw new Error(`unknown deployId: ${id}`);
    return j;
  };

  return {
    create(graphSha) {
      const job: DeployJob = {
        deployId: randomUUID(),
        status: 'queued',
        startedAt: Date.now(),
        agents: [],
        logs: [{ at: Date.now(), level: 'info', message: 'deploy queued' }],
        graphSha,
      };
      jobs.set(job.deployId, job);
      order.push(job.deployId);
      evict();
      return job;
    },
    get(id) {
      return jobs.get(id);
    },
    update(id, patch) {
      const prev = require(id);
      const next = { ...prev, ...patch };
      jobs.set(id, next);
      return next;
    },
    setAgent(id, agent) {
      const prev = require(id);
      const existingIdx = prev.agents.findIndex((a) => a.nodeId === agent.nodeId);
      const agents =
        existingIdx >= 0
          ? prev.agents.map((a, i) => (i === existingIdx ? { ...a, ...agent } : a))
          : [...prev.agents, agent];
      const next = { ...prev, agents };
      jobs.set(id, next);
      return next;
    },
    log(id, level, message) {
      const prev = require(id);
      const next = { ...prev, logs: [...prev.logs, { at: Date.now(), level, message }] };
      jobs.set(id, next);
      return next;
    },
    size() {
      return jobs.size;
    },
  };
}
