import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  RPC_URL: z.string().url(),
  CHAIN_ID: z.coerce.number().int().positive(),
  INDEXER_URL: z.string().url(),
  EXPLORER_URL: z.string().url(),
  STORAGE_EXPLORER_URL: z.string().url(),
  PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'PRIVATE_KEY must be 0x + 64 hex chars'),
  COMPUTE_ROUTER_BASE_URL: z.string().url(),
  COMPUTE_ROUTER_API_KEY: z.string().min(1, 'COMPUTE_ROUTER_API_KEY is required'),
  COMPUTE_MODEL: z.string().default('llama-3.3-70b-instruct'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Invalid environment:\n${issues}\n\nCopy .env.example to .env and fill in values.`,
    );
  }
  return parsed.data;
}
