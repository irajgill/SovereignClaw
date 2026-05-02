import { InMemory, deriveKekFromSigner, encrypted } from '@sovereignclaw/memory';
import { ethers } from 'ethers';
import { describe, expect, it, vi } from 'vitest';
import { Agent, AgentClosedError } from '../src/agent.js';
import type { ChatMessage, InferenceAdapter, InferenceResult } from '../src/inference.js';

const TEST_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const wallet = (): ethers.Wallet => new ethers.Wallet(TEST_PK);

function fakeResult(text: string): InferenceResult {
  return {
    model: 'qwen/qwen-2.5-7b-instruct',
    text,
    usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    attestation: {
      teeVerified: true,
      providerAddress: '0xprovider',
      requestId: 'req-1',
    },
    billing: { inputCost: 100n, outputCost: 50n, totalCost: 150n },
    latencyMs: 42,
    raw: {},
  };
}

function fakeAdapter(text = 'mock reply'): InferenceAdapter & { mock: ReturnType<typeof vi.fn> } {
  const mock = vi.fn().mockResolvedValue(fakeResult(text));
  return { run: mock, mock };
}

describe('Agent basic run loop', () => {
  it('returns the inference result on a happy run', async () => {
    const adapter = fakeAdapter('hello back');
    const agent = new Agent({ role: 'r', inference: adapter });

    const out = await agent.run('hi');
    expect(out?.text).toBe('hello back');
  });

  it('passes a string input through as a user message', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter });

    await agent.run('what is 2+2');
    const messages = adapter.mock.mock.calls[0]![0] as ChatMessage[];
    expect(messages).toEqual([{ role: 'user', content: 'what is 2+2' }]);
  });

  it('prepends the systemPrompt when provided', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({
      role: 'r',
      inference: adapter,
      systemPrompt: 'You are a calculator.',
    });

    await agent.run('2+2');
    const messages = adapter.mock.mock.calls[0]![0] as ChatMessage[];
    expect(messages[0]).toEqual({ role: 'system', content: 'You are a calculator.' });
    expect(messages[1]).toEqual({ role: 'user', content: '2+2' });
  });

  it('passes a ChatMessage[] input through unchanged', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter });

    const input: ChatMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'second' },
    ];
    await agent.run(input);
    const messages = adapter.mock.mock.calls[0]![0] as ChatMessage[];
    expect(messages).toEqual(input);
  });

  it('forwards maxTokens/temperature overrides to the adapter', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter, maxTokens: 100, temperature: 0.2 });

    await agent.run('hi', { maxTokens: 50, temperature: 0.7 });
    const opts = adapter.mock.mock.calls[0]![1];
    expect(opts).toEqual({ maxTokens: 50, temperature: 0.7 });
  });

  it('falls back to config defaults when run-time options are absent', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter, maxTokens: 100, temperature: 0.2 });

    await agent.run('hi');
    const opts = adapter.mock.mock.calls[0]![1];
    expect(opts).toEqual({ maxTokens: 100, temperature: 0.2 });
  });
});

describe('Agent memory and history', () => {
  it('persists context to memory after a run', async () => {
    const adapter = fakeAdapter('the answer is 4');
    const memory = InMemory({ namespace: 'test' });
    const agent = new Agent({ role: 'r', inference: adapter, memory });

    await agent.run('what is 2+2');
    const stored = await memory.get('context');
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(new TextDecoder().decode(stored!));
    expect(parsed.recentMessages).toEqual([
      { role: 'user', content: 'what is 2+2' },
      { role: 'assistant', content: 'the answer is 4' },
    ]);
  });

  it('loads context from memory on subsequent runs', async () => {
    const adapter = fakeAdapter();
    const memory = InMemory({ namespace: 'test' });
    const agent = new Agent({ role: 'r', inference: adapter, memory });

    await agent.run('first question');
    await agent.run('second question');

    const messages = adapter.mock.mock.calls[1]![0] as ChatMessage[];
    expect(messages.length).toBe(3);
    expect(messages[0]?.content).toBe('first question');
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[2]?.content).toBe('second question');
  });

  it('appends a history entry per run', async () => {
    const adapter = fakeAdapter('reply');
    const history = InMemory({ namespace: 'h' });
    const agent = new Agent({ role: 'r', inference: adapter, history });

    await agent.run('q1');
    await agent.run('q2');

    const keys: string[] = [];
    for await (const entry of history.list()) keys.push(entry.key);
    expect(keys.length).toBe(2);
    expect(keys.every((key) => key.startsWith('run:'))).toBe(true);
  });

  it('survives corrupt context', async () => {
    const adapter = fakeAdapter();
    const memory = InMemory({ namespace: 'test' });
    await memory.set('context', new TextEncoder().encode('not-json{{{'));

    const agent = new Agent({ role: 'r', inference: adapter, memory });
    await expect(agent.run('hi')).resolves.not.toBeNull();

    const messages = adapter.mock.mock.calls[0]![0] as ChatMessage[];
    expect(messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('works with encrypted memory wrappers', async () => {
    const adapter = fakeAdapter('encrypted reply');
    const kek = await deriveKekFromSigner(wallet(), 'test');
    const inner = InMemory({ namespace: 'test' });
    const memory = encrypted(inner, { kek });
    const agent = new Agent({ role: 'r', inference: adapter, memory });

    await agent.run('first');
    const stored = await inner.get('context');
    expect(stored).not.toBeNull();
    expect(() => JSON.parse(new TextDecoder().decode(stored!))).toThrow();

    await agent.run('second');
    const messages = adapter.mock.mock.calls[1]![0] as ChatMessage[];
    expect(messages.length).toBe(3);
  });
});

describe('Agent lifecycle hooks', () => {
  it('calls beforeRun before inference', async () => {
    const adapter = fakeAdapter();
    const beforeRun = vi.fn();
    const agent = new Agent({ role: 'r', inference: adapter, beforeRun });

    await agent.run('hi');
    expect(beforeRun).toHaveBeenCalledOnce();
    expect(adapter.mock).toHaveBeenCalledOnce();
    expect(beforeRun.mock.invocationCallOrder[0]).toBeLessThan(
      adapter.mock.mock.invocationCallOrder[0]!,
    );
  });

  it('beforeRun can mutate messages', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({
      role: 'r',
      inference: adapter,
      beforeRun: ({ messages }) => {
        messages.unshift({ role: 'system', content: 'INJECTED' });
      },
    });

    await agent.run('hi');
    const sentMessages = adapter.mock.mock.calls[0]![0] as ChatMessage[];
    expect(sentMessages[0]).toEqual({ role: 'system', content: 'INJECTED' });
  });

  it('beforeRun throwing aborts the run with run.error event', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({
      role: 'r',
      inference: adapter,
      beforeRun: () => {
        throw new Error('blocked');
      },
    });

    let caughtError: unknown;
    agent.on('run.error', ({ error }) => {
      caughtError = error;
    });

    await expect(agent.run('hi')).rejects.toThrow('blocked');
    expect(caughtError).toBeInstanceOf(Error);
    expect(adapter.mock).not.toHaveBeenCalled();
  });

  it('calls afterRun after inference', async () => {
    const adapter = fakeAdapter('the result');
    const afterRun = vi.fn();
    const agent = new Agent({ role: 'r', inference: adapter, afterRun });

    await agent.run('hi');
    expect(afterRun).toHaveBeenCalledOnce();
    expect(afterRun.mock.calls[0]![0].output.text).toBe('the result');
  });

  it('onError suppresses thrown errors when it returns normally', async () => {
    const adapter: InferenceAdapter = {
      run: async () => {
        throw new Error('inference failed');
      },
    };
    const onError = vi.fn().mockResolvedValue(undefined);
    const agent = new Agent({ role: 'r', inference: adapter, onError });

    const out = await agent.run('hi');
    expect(out).toBeNull();
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('Agent events', () => {
  it('emits run.start and run.complete in order', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter });
    const events: string[] = [];
    agent.on('run.start', () => events.push('start'));
    agent.on('run.complete', () => events.push('complete'));

    await agent.run('hi');
    expect(events).toEqual(['start', 'complete']);
  });

  it('emits run.error on failure', async () => {
    const adapter: InferenceAdapter = {
      run: async () => {
        throw new Error('boom');
      },
    };
    const agent = new Agent({ role: 'r', inference: adapter });
    let saw: unknown;
    agent.on('run.error', ({ error }) => {
      saw = error;
    });

    await expect(agent.run('hi')).rejects.toThrow('boom');
    expect((saw as Error).message).toBe('boom');
  });

  it('off() removes a handler', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter });
    const handler = vi.fn();
    agent.on('run.complete', handler);
    agent.off('run.complete', handler);

    await agent.run('hi');
    expect(handler).not.toHaveBeenCalled();
  });

  it('each run gets a unique runId', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter });
    const ids: string[] = [];
    agent.on('run.start', ({ runId }) => ids.push(runId));

    await agent.run('one');
    await agent.run('two');
    expect(ids.length).toBe(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe('Agent close()', () => {
  it('throws AgentClosedError after close()', async () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter });
    await agent.close();
    await expect(agent.run('hi')).rejects.toBeInstanceOf(AgentClosedError);
  });

  it('closes attached memory providers', async () => {
    const adapter = fakeAdapter();
    const memory = InMemory({ namespace: 't' });
    const closeSpy = vi.spyOn(memory, 'close');
    const agent = new Agent({ role: 'r', inference: adapter, memory });

    await agent.close();
    expect(closeSpy).toHaveBeenCalledOnce();
  });
});

describe('Agent tools accessor', () => {
  it('exposes registered tools via .tools', () => {
    const adapter = fakeAdapter();
    const tool = {
      name: 't',
      description: '',
      schema: { safeParse: () => ({ success: true, data: undefined }) } as never,
      run: async () => 'ok',
    };
    const agent = new Agent({ role: 'r', inference: adapter, tools: [tool] });
    expect(agent.tools).toHaveLength(1);
    expect(agent.tools[0]?.name).toBe('t');
  });

  it('returns empty array when no tools configured', () => {
    const adapter = fakeAdapter();
    const agent = new Agent({ role: 'r', inference: adapter });
    expect(agent.tools).toEqual([]);
  });
});
