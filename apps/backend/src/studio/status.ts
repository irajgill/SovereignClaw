/**
 * GET /studio/status/:id
 *
 * Returns the current DeployJob record from the in-memory store. The
 * Studio UI polls this every ~1.5s until status is `done` or `error`.
 * 404 for unknown ids; the Studio client surfaces that as an error.
 */
import { Hono } from 'hono';
import type { DeployStore } from './store.js';

export function studioStatusRoute(deps: { store: DeployStore }) {
  const app = new Hono();
  app.get('/status/:id', (c) => {
    const id = c.req.param('id');
    const job = deps.store.get(id);
    if (!job) {
      return c.json({ error: 'unknown deployId', deployId: id }, 404);
    }
    return c.json(job);
  });
  return app;
}
