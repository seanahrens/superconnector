import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { runTool } from '../tools';
import type { FollowupRow } from '../lib/db';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const url = new URL(c.req.url);
  const status = url.searchParams.get('status') ?? 'open';
  const rows = await c.env.DB.prepare(
    `SELECT f.*, p.display_name FROM followups f
     LEFT JOIN people p ON p.id = f.person_id
     WHERE f.status = ?1 ORDER BY f.due_date NULLS LAST, f.created_at`,
  ).bind(status).all<FollowupRow & { display_name: string | null }>();
  return c.json({ items: rows.results ?? [] });
});

app.post('/', async (c) => {
  const body = await c.req.json<{ person_id: string; body: string; due_date?: string }>();
  const out = await runTool(c.env, 'add_followup', body);
  return c.json(out);
});

app.post('/:id/complete', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status: 'done' | 'dropped' }>();
  const out = await runTool(c.env, 'complete_followup', { id, status: body.status });
  return c.json(out);
});

export default app;
