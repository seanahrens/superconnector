import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { runTool } from '../tools';
import type { TagRow } from '../lib/db';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.*, COUNT(pt.person_id) AS use_count
     FROM tags t LEFT JOIN person_tags pt ON pt.tag_id = t.id
     GROUP BY t.id ORDER BY use_count DESC, t.name ASC`,
  ).all<TagRow & { use_count: number }>();
  return c.json({ tags: rows.results ?? [] });
});

app.get('/proposals', async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM tag_proposals WHERE status = 'pending' ORDER BY created_at`,
  ).all();
  return c.json({ proposals: rows.results ?? [] });
});

app.post('/proposals/:id/review', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    decision: 'accept' | 'merge' | 'reject';
    merge_into_tag_name?: string;
    accepted_category?: 'trajectory' | 'topic' | 'skill' | 'free';
  }>();
  const out = await runTool(c.env, 'review_tag_proposal', { proposal_id: id, ...body });
  return c.json(out);
});

export default app;
