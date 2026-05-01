import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { runTool } from '../tools';
import { nowIso, ulid } from '../lib/ulid';
import { resolvePerson } from '../lib/resolve';
import { applyExtractionResult } from '../lib/people_writes';
import { materializeFromGranolaNote } from '../lib/queue_resolve';
import type { ConfirmationQueueRow } from '../lib/db';

const app = new Hono<{ Bindings: Env }>();

app.get('/', async (c) => {
  const url = new URL(c.req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  const out = await runTool(c.env, 'list_pending_confirmations', { status, limit: 100 });
  return c.json(out);
});

// "Skipped" view: rows from the ingest_log where ingest decided NOT to
// process the note (solo, group, or errored). Lets the user see what would
// otherwise be silently dropped.
app.get('/skipped', async (c) => {
  const url = new URL(c.req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 500);
  const rows = await c.env.DB.prepare(
    `SELECT source, source_ref AS note_id, disposition, note_title, note_created_at, reason, updated_at
       FROM ingest_log
      WHERE disposition IN ('skipped_solo', 'skipped_group', 'errored')
      ORDER BY COALESCE(note_created_at, updated_at) DESC
      LIMIT ?1`,
  ).bind(limit).all<{
    source: string;
    note_id: string;
    disposition: string;
    note_title: string | null;
    note_created_at: string | null;
    reason: string | null;
    updated_at: string;
  }>();
  return c.json({ items: rows.results ?? [] });
});

// "Processed" view for the Notes tab: meetings successfully ingested, joined
// with the resolved person. One row per meeting, newest first.
app.get('/processed', async (c) => {
  const url = new URL(c.req.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);
  const rows = await c.env.DB.prepare(
    `SELECT m.id AS meeting_id, m.source_ref AS note_id, m.recorded_at,
            m.event_title, m.classification, m.summary,
            p.id AS person_id, p.display_name, p.primary_email
       FROM meetings m
       LEFT JOIN people p ON p.id = m.person_id
      WHERE m.source = 'granola'
      ORDER BY m.recorded_at DESC
      LIMIT ?1`,
  ).bind(limit).all<{
    meeting_id: string;
    note_id: string | null;
    recorded_at: string;
    event_title: string | null;
    classification: string;
    summary: string | null;
    person_id: string | null;
    display_name: string | null;
    primary_email: string | null;
  }>();
  return c.json({ items: rows.results ?? [] });
});

app.post('/:id/resolve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    decision: 'resolve' | 'dismiss';
    selected_person_id?: string;
    new_person?: { name?: string; email?: string };
    counterpart?: { name?: string; email?: string };
    classification?: '1:1' | 'group' | 'ambiguous';
    accept_extraction?: boolean;
  }>();

  const item = await c.env.DB.prepare('SELECT * FROM confirmation_queue WHERE id = ?1').bind(id).first<ConfirmationQueueRow>();
  if (!item) return c.json({ error: 'not found' }, 404);

  if (body.decision === 'dismiss') {
    await c.env.DB.prepare(`UPDATE confirmation_queue SET status = 'dismissed' WHERE id = ?1`).bind(id).run();
    return c.json({ ok: true });
  }

  // Resolve path. The handler used to just flip the status; now it actually
  // finishes the ingest work that was deferred when we put the item in the
  // queue (re-fetch the Granola note, resolve/create person, insert meeting,
  // run extraction).
  try {
    if (item.kind === 'meeting_classification') {
      const payload = JSON.parse(item.payload) as {
        note: { id: string; title?: string | null };
        attendees?: Array<{ email: string | null; name: string | null }>;
      };
      const cls = body.classification ?? '1:1';
      // Group meetings still skip ingestion — just record the decision.
      if (cls === 'group') {
        await c.env.DB.prepare(
          `UPDATE confirmation_queue SET status = 'resolved' WHERE id = ?1`,
        ).bind(id).run();
        return c.json({ ok: true, skipped: 'group meeting' });
      }

      // Need a counterpart for 1:1. Prefer explicit selection, then explicit
      // counterpart info, then attendees stashed on the queue payload.
      let personId = body.selected_person_id;
      let counterpart: { name?: string | null; email?: string | null } | undefined =
        body.counterpart ?? body.new_person;
      if (!personId && !counterpart) {
        const stashed = payload.attendees?.[0];
        if (stashed && (stashed.email || stashed.name)) {
          counterpart = { email: stashed.email, name: stashed.name };
        }
      }
      if (!personId && !counterpart) {
        return c.json({ error: 'meeting_classification 1:1 needs a counterpart (selected_person_id, counterpart, or new_person)' }, 400);
      }

      const result = await materializeFromGranolaNote(c.env, {
        noteId: payload.note.id,
        classification: '1:1',
        personId,
        counterpart,
      });
      await c.env.DB.prepare(
        `UPDATE confirmation_queue
         SET payload = json_set(payload, '$.resolved_person_id', ?1, '$.resolved_meeting_id', ?2),
             status = 'resolved'
         WHERE id = ?3`,
      ).bind(result.personId, result.meetingId, id).run();
      return c.json({ ok: true, person_id: result.personId, meeting_id: result.meetingId });
    }

    if (item.kind === 'person_resolution') {
      const payload = JSON.parse(item.payload) as {
        note?: { id?: string };
        attendee?: { name?: string | null; email?: string | null } | null;
      };
      let chosenPersonId = body.selected_person_id;
      if (!chosenPersonId && body.new_person) {
        const r = await resolvePerson(c.env, body.new_person);
        chosenPersonId = r.personId;
      }
      if (!chosenPersonId && payload.attendee && (payload.attendee.email || payload.attendee.name)) {
        const r = await resolvePerson(c.env, payload.attendee);
        if (!r.ambiguous) chosenPersonId = r.personId;
      }
      if (!chosenPersonId) return c.json({ error: 'must pick a person or create new' }, 400);

      const noteId = payload.note?.id;
      if (noteId) {
        const result = await materializeFromGranolaNote(c.env, {
          noteId,
          classification: '1:1',
          personId: chosenPersonId,
        });
        await c.env.DB.prepare(
          `UPDATE confirmation_queue
           SET payload = json_set(payload, '$.resolved_person_id', ?1, '$.resolved_meeting_id', ?2),
               status = 'resolved'
           WHERE id = ?3`,
        ).bind(result.personId, result.meetingId, id).run();
        return c.json({ ok: true, person_id: result.personId, meeting_id: result.meetingId });
      }

      // No note id (rare) — fall back to old behavior.
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
      // Look up the meeting's actual recorded_at so we don't accidentally
      // bump last_met_date to today when accepting an extraction.
      const m = await c.env.DB.prepare(
        'SELECT recorded_at FROM meetings WHERE id = ?1',
      ).bind(payload.meeting_id).first<{ recorded_at: string | null }>();
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
        meetingRecordedAt: m?.recorded_at ?? null,
        // Reviewing an extraction for an already-counted meeting — don't
        // re-bump meeting_count.
        reprocess: true,
      });
      await c.env.DB.prepare(`UPDATE confirmation_queue SET status = 'resolved' WHERE id = ?1`).bind(id).run();
      return c.json({ ok: true });
    }

    // Unknown kind or missing args — generic resolve.
    await c.env.DB.prepare(`UPDATE confirmation_queue SET status = 'resolved' WHERE id = ?1`).bind(id).run();
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
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
