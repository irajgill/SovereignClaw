// packages/studio/app/api/seed/route.ts
//
// Returns the pre-seeded Studio graph + the codegen output. Used by the
// landing-page demo to drive a real /studio/deploy POST without having
// to embed the graph inline in static HTML.

import { NextResponse } from 'next/server';
import { seedGraph } from '../../../lib/seed-graph.js';
import { generateCode } from '../../../lib/codegen.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const graph = seedGraph();
  const { source: code } = generateCode(graph);
  return NextResponse.json({ graph, code });
}
