// Admin / repair endpoints. Auth is gated at /api/* in the parent router.
//
// These exist so the user (and AI agents acting as the user) can fix
// historical-data bugs without dropping the DB. Every endpoint here is
// designed to be idempotent — re-running it after the first call should
// be a no-op or return zero changes.

import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { runIngest } from '../cron/ingest';
import { recomputePersonMeetingStats } from '../lib/meetings';
import { normalizeTagName } from '../lib/tag_norm';
import { parseJsonArray } from '../lib/db';
import { nowIso } from '../lib/ulid';
import { asJson } from './errors';

const app = new Hono<{ Bindings: Env }>();

// Admin: clean up phantom (unknown) people created before ingest hardening.
// People with no email, no name, and zero meetings are pure noise — delete them
// and any tags/signals/followups that referenced them.
app.post('/cleanup-phantoms', async (c) => {
  const phantoms = await c.env.DB.prepare(
    `SELECT id FROM people
     WHERE (display_name IS NULL OR display_name = '')
       AND (primary_email IS NULL OR primary_email = '')
       AND meeting_count = 0`,
  ).all<{ id: string }>();
  const ids = (phantoms.results ?? []).map((r) => r.id);
  for (const id of ids) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM person_tags WHERE person_id = ?1').bind(id),
      c.env.DB.prepare('DELETE FROM signals WHERE person_id = ?1').bind(id),
      c.env.DB.prepare('DELETE FROM followups WHERE person_id = ?1').bind(id),
      c.env.DB.prepare('DELETE FROM people WHERE id = ?1').bind(id),
    ]);
  }
  return c.json({ deleted: ids.length });
});

// Admin: recompute last_met_date and meeting_count for every person from
// the meetings table. Use to repair people whose last_met_date was set to
// the ingest time instead of the actual meeting time (pre-W fix).
app.post('/backfill-last-met', async (c) => {
  const r = await c.env.DB.prepare(
    `UPDATE people SET
       last_met_date = (
         SELECT substr(MAX(recorded_at), 1, 10)
         FROM meetings WHERE meetings.person_id = people.id
       ),
       meeting_count = (
         SELECT COUNT(*) FROM meetings WHERE meetings.person_id = people.id
       ),
       updated_at = ?1`,
  ).bind(nowIso()).run();
  return c.json({ ok: true, rows_updated: r.meta.changes ?? 0 });
});

// Admin: replace underscores with spaces (and lowercase) across every tag /
// trajectory_tag / role / tag_proposal in the DB. Idempotent. Run after the
// V fix to clean up historical data.
app.post('/normalize-tags', async (c) => {
  let tagsRenamed = 0;
  let tagsMerged = 0;
  let proposalsRenamed = 0;
  let peopleArraysFixed = 0;

  // 1. tags table — rename, merge duplicates by canonical name.
  const tags = await c.env.DB.prepare('SELECT id, name FROM tags').all<{ id: string; name: string }>();
  const byCanonical = new Map<string, { id: string; name: string }[]>();
  for (const t of tags.results ?? []) {
    const canon = normalizeTagName(t.name);
    if (!byCanonical.has(canon)) byCanonical.set(canon, []);
    byCanonical.get(canon)!.push(t);
  }
  for (const [canon, group] of byCanonical) {
    if (group.length === 1) {
      if (group[0]!.name !== canon) {
        await c.env.DB.prepare('UPDATE tags SET name = ?1 WHERE id = ?2').bind(canon, group[0]!.id).run();
        tagsRenamed++;
      }
      continue;
    }
    // Multiple rows collapse to one canonical name. Keep the oldest, repoint
    // person_tags, delete the rest.
    const [keep, ...drop] = group;
    if (keep!.name !== canon) {
      await c.env.DB.prepare('UPDATE tags SET name = ?1 WHERE id = ?2').bind(canon, keep!.id).run();
      tagsRenamed++;
    }
    for (const d of drop) {
      await c.env.DB.prepare(
        `UPDATE OR IGNORE person_tags SET tag_id = ?1 WHERE tag_id = ?2`,
      ).bind(keep!.id, d.id).run();
      await c.env.DB.prepare('DELETE FROM person_tags WHERE tag_id = ?1').bind(d.id).run();
      await c.env.DB.prepare('DELETE FROM tags WHERE id = ?1').bind(d.id).run();
      tagsMerged++;
    }
  }

  // 2. tag_proposals — normalize proposed_name in place.
  const props = await c.env.DB.prepare(
    'SELECT id, proposed_name FROM tag_proposals',
  ).all<{ id: string; proposed_name: string }>();
  for (const p of props.results ?? []) {
    const canon = normalizeTagName(p.proposed_name);
    if (canon !== p.proposed_name) {
      await c.env.DB.prepare(
        'UPDATE tag_proposals SET proposed_name = ?1 WHERE id = ?2',
      ).bind(canon, p.id).run();
      proposalsRenamed++;
    }
  }

  // 3. people.trajectory_tags + people.roles — normalize JSON arrays in place.
  const people = await c.env.DB.prepare(
    'SELECT id, trajectory_tags, roles FROM people',
  ).all<{ id: string; trajectory_tags: string | null; roles: string | null }>();
  for (const p of people.results ?? []) {
    const oldTraj = parseJsonArray(p.trajectory_tags);
    const oldRoles = parseJsonArray(p.roles);
    const newTraj = [...new Set(oldTraj.map(normalizeTagName).filter(Boolean))];
    const newRoles = [...new Set(oldRoles.map(normalizeTagName).filter(Boolean))];
    const trajChanged = JSON.stringify(oldTraj) !== JSON.stringify(newTraj);
    const rolesChanged = JSON.stringify(oldRoles) !== JSON.stringify(newRoles);
    if (trajChanged || rolesChanged) {
      await c.env.DB.prepare(
        'UPDATE people SET trajectory_tags = ?1, roles = ?2 WHERE id = ?3',
      ).bind(JSON.stringify(newTraj), JSON.stringify(newRoles), p.id).run();
      peopleArraysFixed++;
    }
  }

  return c.json({
    tags_renamed: tagsRenamed,
    tags_merged: tagsMerged,
    proposals_renamed: proposalsRenamed,
    people_arrays_fixed: peopleArraysFixed,
  });
});

// Admin: delete every meetings row with source='user_dictation'. The
// dictate tool used to manufacture a meetings row whenever someone added
// a person via chat, which leaked into "recent meetings" with a recorded_at
// of when the dictation happened (not when the meeting actually occurred).
// dictate no longer creates a meetings row, so anything still in the DB
// with this source is spurious.
app.post('/cleanup-dictation-meetings', (c) =>
  deleteMeetingsAndRecompute(c.env, `source = 'user_dictation'`, []),
);

// Admin: delete meeting rows whose event_start (or recorded_at, when no
// event_start exists) is in the future. Granola pre-creates notes for
// upcoming calendar invites; before the future-event guard landed those
// could leak in as "past meetings".
app.post('/cleanup-future-meetings', (c) => {
  const nowIsoStr = nowIso();
  return deleteMeetingsAndRecompute(
    c.env,
    `(event_start IS NOT NULL AND event_start > ?1) OR (event_start IS NULL AND recorded_at > ?1)`,
    [nowIsoStr],
  );
});

// Admin: dismiss every pending queue item. Use after a logic change makes the
// existing pending items stale.
app.post('/clear-queue', async (c) => {
  const r = await c.env.DB.prepare(
    `UPDATE confirmation_queue SET status = 'dismissed' WHERE status = 'pending'`,
  ).run();
  return c.json({ dismissed: r.meta.changes ?? 0 });
});

// Admin: reset the Granola high-water mark so the next ingest re-pulls notes.
// Existing meetings are kept; getExistingMeeting() skips them by source_ref
// unless the note's content hash has changed (which then triggers reprocess).
app.post('/reset-ingest', async (c) => {
  await c.env.DB.prepare(`DELETE FROM ingest_state WHERE source = 'granola'`).run();
  return c.json({ ok: true });
});

// Admin: force a Granola sweep starting at `since` (ISO 8601). Use this after
// editing a batch of note titles in Granola — it ignores the high-water mark
// for one run, so every note >= since is checked for content changes and
// reprocessed in place. Cheaper than nuking the high-water mark.
app.post(
  '/repull-granola',
  asJson<{ Bindings: Env }>(async (c) => {
    const url = new URL(c.req.url);
    const since = url.searchParams.get('since') ?? '1970-01-01T00:00:00Z';
    const result = await runIngest(c.env, { forceSince: since });
    return c.json(result);
  }, 'admin/repull-granola'),
);

// Shared between the dictation-cleanup and future-meeting-cleanup endpoints.
// Deletes meetings matching `whereSql`, detaches dependent rows, and
// recomputes meeting_count / last_met_date for every person who lost a row.
async function deleteMeetingsAndRecompute(
  env: Env,
  whereSql: string,
  binds: unknown[],
): Promise<Response> {
  const found = await env.DB.prepare(
    `SELECT id, person_id FROM meetings WHERE ${whereSql}`,
  ).bind(...binds).all<{ id: string; person_id: string | null }>();
  const rows = found.results ?? [];
  const personIds = new Set<string>();
  for (const r of rows) {
    if (r.person_id) personIds.add(r.person_id);
    await env.DB.batch([
      // Detach signals from the meeting (keep the signal — its body is
      // useful — but it shouldn't anchor a phantom meeting).
      env.DB.prepare('UPDATE signals SET meeting_id = NULL WHERE meeting_id = ?1').bind(r.id),
      env.DB.prepare('UPDATE followups SET meeting_id = NULL WHERE meeting_id = ?1').bind(r.id),
      env.DB.prepare('DELETE FROM meetings WHERE id = ?1').bind(r.id),
    ]);
  }
  for (const pid of personIds) {
    await recomputePersonMeetingStats(env, pid);
  }
  return Response.json({ meetings_deleted: rows.length, people_recomputed: personIds.size });
}

export default app;
