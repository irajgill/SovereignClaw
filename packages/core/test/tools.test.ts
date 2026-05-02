import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolExecutionError, ToolTimeoutError, ToolValidationError } from '../src/errors.js';
import { defineTool, executeTool, httpRequestTool } from '../src/tools.js';

describe('defineTool + executeTool', () => {
  it('runs a tool with valid input', async () => {
    const sum = defineTool({
      name: 'sum',
      description: 'Add two numbers',
      schema: z.object({ a: z.number(), b: z.number() }),
      run: async ({ a, b }) => a + b,
    });

    const result = await executeTool(sum, { a: 2, b: 3 });
    expect(result).toBe(5);
  });

  it('throws ToolValidationError on bad input', async () => {
    const sum = defineTool({
      name: 'sum',
      description: 'Add two numbers',
      schema: z.object({ a: z.number(), b: z.number() }),
      run: async ({ a, b }) => a + b,
    });

    await expect(executeTool(sum, { a: 'two', b: 3 })).rejects.toBeInstanceOf(ToolValidationError);
  });

  it('wraps run() exceptions in ToolExecutionError with original cause', async () => {
    const root = new Error('underlying');
    const broken = defineTool({
      name: 'broken',
      description: '',
      schema: z.object({}),
      run: async () => {
        throw root;
      },
    });

    try {
      await executeTool(broken, {});
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ToolExecutionError);
      expect((err as ToolExecutionError).cause).toBe(root);
      expect((err as ToolExecutionError).toolName).toBe('broken');
    }
  });

  it('throws ToolTimeoutError when the tool exceeds its timeout', async () => {
    const slow = defineTool({
      name: 'slow',
      description: '',
      schema: z.object({}),
      timeoutMs: 30,
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return 'done';
      },
    });

    await expect(executeTool(slow, {})).rejects.toBeInstanceOf(ToolTimeoutError);
  });

  it('does not re-wrap a thrown ToolValidationError', async () => {
    const tool = defineTool({
      name: 't',
      description: '',
      schema: z.object({}),
      run: async () => {
        throw new ToolValidationError('inner', []);
      },
    });

    await expect(executeTool(tool, {})).rejects.toBeInstanceOf(ToolValidationError);
  });
});

describe('httpRequestTool', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('makes a GET request and returns status, headers, body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers({ 'content-type': 'text/plain' }),
        text: async (): Promise<string> => 'response body',
      }) as unknown as typeof fetch,
    );

    const tool = httpRequestTool();
    const out = await executeTool(tool, { url: 'https://example.com' });
    expect(out.status).toBe(200);
    expect(out.body).toBe('response body');
    expect(out.headers['content-type']).toBe('text/plain');
  });

  it('rejects URLs not in allowedHosts', async () => {
    const tool = httpRequestTool({ allowedHosts: ['allowed.example'] });
    await expect(executeTool(tool, { url: 'https://other.example/path' })).rejects.toBeInstanceOf(
      ToolExecutionError,
    );
  });

  it('allows URLs in allowedHosts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        status: 200,
        headers: new Headers(),
        text: async (): Promise<string> => 'ok',
      }) as unknown as typeof fetch,
    );

    const tool = httpRequestTool({ allowedHosts: ['allowed.example'] });
    const out = await executeTool(tool, { url: 'https://allowed.example/path' });
    expect(out.status).toBe(200);
  });

  it('rejects malformed URLs at validation', async () => {
    const tool = httpRequestTool();
    await expect(executeTool(tool, { url: 'not-a-url' })).rejects.toBeInstanceOf(
      ToolValidationError,
    );
  });
});
