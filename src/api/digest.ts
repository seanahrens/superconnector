// On-demand endpoints for previewing daily-email content from the web UI.

import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { waysToHelp } from '../plays/ways_to_help';
import { buildWeeklyDigest } from '../plays/weekly_digest';
import { briefForPerson } from '../plays/brief';

const app = new Hono<{ Bindings: Env }>();

app.get('/ways-to-help', async (c) => {
  const url = new URL(c.req.url);
  const limit = Number(url.searchParams.get('limit') ?? 5);
  const items = await waysToHelp(c.env, limit);
  return c.json({ items });
});

app.get('/weekly', async (c) => {
  const out = await buildWeeklyDigest(c.env);
  return c.json(out);
});

app.get('/brief/:person_id', async (c) => {
  const brief = await briefForPerson(c.env, c.req.param('person_id'));
  if (!brief) return c.json({ error: 'not found' }, 404);
  return c.json(brief);
});

export default app;
