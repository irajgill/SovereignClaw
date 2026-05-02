/**
 * Tool interface and runtime for agent tools.
 *
 * Phase 1 Turn A ships the interface/runtime and the httpRequest built-in.
 */
import { z } from 'zod';
import { ToolExecutionError, ToolTimeoutError, ToolValidationError } from './errors.js';

export interface Tool<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly schema: z.ZodType<TInput>;
  readonly timeoutMs?: number;
  run(args: TInput): Promise<TOutput>;
}

export function defineTool<TInput, TOutput>(spec: {
  name: string;
  description: string;
  schema: z.ZodType<TInput>;
  timeoutMs?: number;
  run: (args: TInput) => Promise<TOutput>;
}): Tool<TInput, TOutput> {
  return spec;
}

export async function executeTool<TInput, TOutput>(
  tool: Tool<TInput, TOutput>,
  args: unknown,
  options?: { defaultTimeoutMs?: number },
): Promise<TOutput> {
  const parsed = tool.schema.safeParse(args);
  if (!parsed.success) {
    throw new ToolValidationError(tool.name, parsed.error.issues);
  }

  const timeoutMs = tool.timeoutMs ?? options?.defaultTimeoutMs ?? 30_000;
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      tool.run(parsed.data),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ToolTimeoutError(tool.name, timeoutMs)), timeoutMs);
      }),
    ]);
  } catch (err) {
    if (err instanceof ToolValidationError || err instanceof ToolTimeoutError) {
      throw err;
    }
    throw new ToolExecutionError(tool.name, err);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const httpRequestSchema = z.object({
  url: z.string().url(),
  method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']).optional(),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
});

export interface HttpRequestOptions {
  allowedHosts?: string[];
  timeoutMs?: number;
}

export function httpRequestTool(
  options?: HttpRequestOptions,
): Tool<
  z.infer<typeof httpRequestSchema>,
  { status: number; headers: Record<string, string>; body: string }
> {
  return defineTool({
    name: 'httpRequest',
    description:
      'Make an HTTP request. Useful for fetching API data or web pages. ' +
      'Returns status code, response headers, and response body as text.',
    schema: httpRequestSchema,
    timeoutMs: options?.timeoutMs ?? 10_000,
    run: async (args) => {
      if (options?.allowedHosts && options.allowedHosts.length > 0) {
        const url = new URL(args.url);
        if (!options.allowedHosts.includes(url.hostname)) {
          throw new Error(
            `httpRequest: host '${url.hostname}' not in allowedHosts ` +
              `[${options.allowedHosts.join(', ')}]`,
          );
        }
      }

      const res = await fetch(args.url, {
        method: args.method ?? 'GET',
        headers: args.headers,
        body: args.body,
      });

      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => {
        headers[key] = value;
      });

      return {
        status: res.status,
        headers,
        body: await res.text(),
      };
    },
  });
}
