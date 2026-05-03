// packages/studio/app/api/seed/route.ts
//
// Returns the pre-seeded Studio graph + the codegen output. Used by the
// landing-page demo to drive a real /studio/deploy POST without having
// to embed the graph inline in static HTML.

import { NextResponse } from 'next/server';
// No .js extension — Next.js + tsconfig.json's bundler-style resolution
// reads the .ts source directly. Adding .js only works locally because
// `tsc -p tsconfig.lib.json` emits sibling .js files; those aren't
// committed (08de306 ships them only into the npm tarball + Docker
// image, not into git).
import { seedGraph } from '../../../lib/seed-graph';
import { generateCode } from '../../../lib/codegen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const graph = seedGraph();
  const { source: code } = generateCode(graph);
  return NextResponse.json({ graph, code });
}
