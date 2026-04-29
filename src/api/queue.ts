import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { runTool } from '../tools';
import { nowIso, ulid } from '../lib/ulid';
import { resolvePerson } from '../lib/resolve';
import { applyExtractionResult } from '../lib/people_writes';
import type { ConfirmationQueueRow } from '../lib/db';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const url = new URL(c.req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const out = await runTool(c.env, 'list_pending_confirmations', { status, limit: 100 });
  return c.json(out);
});

app.post('/:id/resolve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    decision: 'resolve' | 'dismiss';
    selected_person_id?: string;
    new_person?: { name?: string; email?: string };
    classification?: '1:1' | 'group' | 'ambiguous';
    accept_extraction?: boolean;
  }>();

  const item = await c.env.DB.prepare('SELECT * FROM confirmation_queue WHERE id = ?1').bind(id).first<ConfirmationQueueRow>();
  if (!item) return c.json({ error: 'not found' }, 404);

  // Side-effects per kind, then mark resolved.
  if (body.decision === 'resolve') {
    if (item.kind === 'person_resolution') {
      let chosenPersonId = body.selected_person_id;
      if (!chosenPersonId && body.new_person) {
        const r = await resolvePerson(c.env, body.new_person);
        chosenPersonId = r.personId;
      }
      if (!chosenPersonId) return c.json({ error: 'must pick a person or create new' }, 400);
      await c.env.DB.prepare(
        `UPDATE confirmation_queue
         SET payload = json_set(payload, '$.resolved_person_id', ?1), status = 'resolved'
         WHERE id = ?2`,
      ).bind(chosenPersonId, id).run();
      return c.json({ ok: true, person_id: chosenPersonId });
    }
    if (item.kind === 'extraction_review' && body.accept_extraction) {
      const payload = JSON.parse(item.payload) as {
        person_id: string;
        meeting_id: string;
        updates: import('../lib/extract').ExtractedPersonUpdates;
        summary?: string;
      };
      await applyExtractionResult(c.env, {
        personId: payload.person_id,
        meetingId: payload.meeting_id,
        result: {
          person_updates: payload.updates,
          signals: [],
          tag_proposals: [],
          followups: [],
          summary: payload.summary ?? '',
          extraction_confidence: 1.0,
        },
      });
    }
  }

  await c.env.DB.prepare(
    `UPDATE confirmation_queue SET status = ?1 WHERE id = ?2`,
  ).bind(body.decision === 'resolve' ? 'resolved' : 'dismissed', id).run();
  return c.json({ ok: true });
});

// Manual queue insertion (rarely used, but handy for the UI).
app.post('/', async (c) => {
  const body = await c.req.json<{ kind: string; payload: unknown }>();
  const id = ulid();
  await c.env.DB.prepare(
    `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
     VALUES (?1, ?2, ?3, 'pending', ?4)`,
  ).bind(id, body.kind, JSON.stringify(body.payload), nowIso()).run();
  return c.json({ id });
});

export default app;
