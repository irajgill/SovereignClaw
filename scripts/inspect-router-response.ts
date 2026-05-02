/**
 * Step 1.0 diagnostic — find where `tee_verified` lives in the Router response.
 *
 * Phase 0 left this as `unknown (field absent)` because the smoke test only
 * checked two paths (`data.tee_verified` and `data.trace.tee_verified`).
 * Both were null. The field exists somewhere — the Router docs guarantee it
 * when `verify_tee: true` is sent — we just don't know where.
 *
 * This script:
 *   1. Sends one chat completion with verify_tee: true.
 *   2. Pretty-prints the entire response JSON.
 *   3. Walks every key recursively, prints any path matching /tee/i or /verif/i.
 *   4. Prints a summary so we can copy/paste the discovered path into dev-log.md.
 *
 * Run once, paste output, delete this file (or keep it; it's harmless).
 */
import { loadEnv } from './lib/env.js';
import { logger } from './lib/logger.js';

interface AnyObject {
  [k: string]: unknown;
}

function isObject(x: unknown): x is AnyObject {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

/** Walk every path in the response. Returns array of "a.b.c" → value pairs. */
function walk(obj: unknown, prefix = ''): Array<{ path: string; value: unknown }> {
  const out: Array<{ path: string; value: unknown }> = [];
  if (isObject(obj)) {
    for (const [k, v] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${k}` : k;
      out.push({ path, value: v });
      if (isObject(v) || Array.isArray(v)) {
        out.push(...walk(v, path));
      }
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((v, i) => {
      const path = `${prefix}[${i}]`;
      out.push({ path, value: v });
      if (isObject(v) || Array.isArray(v)) {
        out.push(...walk(v, path));
      }
    });
  }
  return out;
}

async function main() {
  const env = loadEnv();
  const url = `${env.COMPUTE_ROUTER_BASE_URL}/chat/completions`;

  logger.info({ model: env.COMPUTE_MODEL, url }, 'inspect: sending request with verify_tee=true');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.COMPUTE_ROUTER_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.COMPUTE_MODEL,
      messages: [
        { role: 'system', content: 'You answer in exactly one short sentence.' },
        { role: 'user', content: 'Say hello to SovereignClaw.' },
      ],
      max_tokens: 64,
      temperature: 0,
      verify_tee: true,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    logger.error({ status: res.status, body: text.slice(0, 1000) }, 'inspect: request failed');
    process.exit(1);
  }

  const data = JSON.parse(text) as unknown;

  console.log('\n============================================================');
  console.log('FULL RESPONSE BODY');
  console.log('============================================================');
  console.log(JSON.stringify(data, null, 2));

  console.log('\n============================================================');
  console.log('TOP-LEVEL KEYS');
  console.log('============================================================');
  if (isObject(data)) {
    console.log(Object.keys(data).join(', '));
  } else {
    console.log('(response is not an object)');
  }

  console.log('\n============================================================');
  console.log('PATHS MATCHING /tee/i OR /verif/i');
  console.log('============================================================');
  const all = walk(data);
  const matched = all.filter((entry) => /tee/i.test(entry.path) || /verif/i.test(entry.path));
  if (matched.length === 0) {
    console.log('(none found — the field may not be returned by this provider, or');
    console.log(' it has a different name. Look at the FULL RESPONSE BODY above.)');
  } else {
    for (const entry of matched) {
      const valuePreview =
        typeof entry.value === 'object'
          ? `<${Array.isArray(entry.value) ? 'array' : 'object'}>`
          : JSON.stringify(entry.value);
      console.log(`  ${entry.path}  =  ${valuePreview}`);
    }
  }

  console.log('\n============================================================');
  console.log('HEADERS');
  console.log('============================================================');
  // Some APIs put attestation in headers, not the body. Check.
  res.headers.forEach((v, k) => {
    if (/tee|verif|attest/i.test(k)) {
      console.log(`  ${k}: ${v}`);
    }
  });
  console.log('(only headers matching /tee|verif|attest/i shown above; rest omitted)');

  console.log('\n============================================================');
  console.log('NEXT STEP');
  console.log('============================================================');
  console.log('Copy the matched path(s) into the chat. We update sealed0GInference');
  console.log('to read from that path and convert it to a typed attestation block.\n');
}

main().catch((err) => {
  logger.error(
    { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
    'inspect: failed',
  );
  process.exit(1);
});
