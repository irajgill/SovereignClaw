// packages/studio/app/api/studio/[...path]/route.ts
//
// Same-origin proxy: forwards /api/studio/* on the Studio Vercel deployment
// to the upstream backend (Railway dev oracle's /studio/* routes). Solves
// the browser CORS gate without touching any Vercel or Railway settings.
//
// Browser → /api/studio/deploy   (same origin, no preflight)
//        → Vercel function       (server-side fetch — no CORS in node)
//        → https://<backend>/studio/deploy
//
// Reads upstream URL from NEXT_PUBLIC_STUDIO_BACKEND_URL (same var the
// browser used before, now read server-side). Falls back to
// http://localhost:8787 for local dev so `pnpm dev` still works.
//
// Pass-through of Authorization is intentional: when the operator runs a
// fully-bearer-locked backend, the client still attaches the token via
// localStorage and we forward it as-is.

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function upstreamBase(): string {
  return (
    process.env.STUDIO_BACKEND_UPSTREAM ??
    process.env.NEXT_PUBLIC_STUDIO_BACKEND_URL ??
    'http://localhost:8787'
  ).replace(/\/+$/, '');
}

function buildHeaders(req: Request): Headers {
  const headers = new Headers();
  const ct = req.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  const auth = req.headers.get('authorization');
  if (auth) headers.set('authorization', auth);
  return headers;
}

async function forward(
  req: Request,
  pathSegments: string[],
  method: 'GET' | 'POST',
): Promise<Response> {
  const upstream = `${upstreamBase()}/studio/${pathSegments.join('/')}`;
  const init: RequestInit = {
    method,
    headers: buildHeaders(req),
  };
  if (method === 'POST') {
    init.body = await req.text();
  }
  let res: Response;
  try {
    res = await fetch(upstream, init);
  } catch (err) {
    return NextResponse.json(
      {
        error: 'studio-proxy: upstream fetch failed',
        upstream,
        cause: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }
  // Mirror the upstream response straight through; preserve status + body.
  const body = await res.text();
  const out = new NextResponse(body, { status: res.status });
  const ct = res.headers.get('content-type');
  if (ct) out.headers.set('content-type', ct);
  return out;
}

export async function GET(
  req: Request,
  ctx: { params: { path: string[] } },
): Promise<Response> {
  return forward(req, ctx.params.path, 'GET');
}

export async function POST(
  req: Request,
  ctx: { params: { path: string[] } },
): Promise<Response> {
  return forward(req, ctx.params.path, 'POST');
}
