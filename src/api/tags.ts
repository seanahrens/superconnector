import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { runTool } from '../tools';
import type { TagRow } from '../lib/db';
import { normalizeTagName } from '../lib/tag_norm';

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

// One tag with the people that have it. Defined AFTER /proposals so the
// `/:id` pattern doesn't shadow the more specific routes.
app.get('/:id', async (c) => {
  const id = c.req.param('id');
  const tag = await c.env.DB.prepare('SELECT * FROM tags WHERE id = ?1').bind(id).first<TagRow>();
  if (!tag) return c.json({ error: 'not found' }, 404);
  const people = await c.env.DB.prepare(
    `SELECT p.id AS person_id, p.display_name, p.primary_email
       FROM person_tags pt
       JOIN people p ON p.id = pt.person_id
      WHERE pt.tag_id = ?1
      ORDER BY p.display_name COLLATE NOCASE`,
  ).bind(id).all<{ person_id: string; display_name: string | null; primary_email: string | null }>();
  return c.json({ tag, people: people.results ?? [] });
});

// Rename. If the new name collides with an existing tag, merge the rows
// (move person_tags onto the existing tag) and delete this one — the
// "I had two synonyms and want to combine them" case.
app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; category?: string }>();
  const tag = await c.env.DB.prepare('SELECT * FROM tags WHERE id = ?1').bind(id).first<TagRow>();
  if (!tag) return c.json({ error: 'not found' }, 404);

  const newName = body.name !== undefined ? normalizeTagName(body.name) : tag.name;
  const newCategory = body.category ?? tag.category ?? null;
  if (!newName) return c.json({ error: 'name required' }, 400);

  const collide = await c.env.DB.prepare(
    'SELECT id FROM tags WHERE name = ?1 AND id != ?2',
  ).bind(newName, id).first<{ id: string }>();
  if (collide) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO person_tags (person_id, tag_id, source_meeting_id, created_at)
         SELECT person_id, ?1, source_meeting_id, created_at FROM person_tags WHERE tag_id = ?2`,
      ).bind(collide.id, id),
      c.env.DB.prepare('DELETE FROM person_tags WHERE tag_id = ?1').bind(id),
      c.env.DB.prepare('DELETE FROM tags WHERE id = ?1').bind(id),
    ]);
    return c.json({ ok: true, merged_into: collide.id });
  }

  await c.env.DB.prepare(
    'UPDATE tags SET name = ?1, category = ?2 WHERE id = ?3',
  ).bind(newName, newCategory, id).run();
  return c.json({ ok: true, id, name: newName, category: newCategory });
});

app.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM person_tags WHERE tag_id = ?1').bind(id),
    c.env.DB.prepare('DELETE FROM tags WHERE id = ?1').bind(id),
  ]);
  return c.json({ ok: true });
});

export default app;
