import { Hono } from 'hono';
import type { Env } from '../worker-configuration';
import { runIngest } from './cron/ingest';
import { runDailyEmail } from './cron/daily_email';
import { runBackup } from './cron/backup';
import { handleMcp } from './mcp/server';
import { requireAuth } from './api/auth';
import people from './api/people';
import queue from './api/queue';
import tags from './api/tags';
import followups from './api/followups';
import chat from './api/chat';
import digest from './api/digest';
import notes from './api/notes';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', async (c) => {
  const dbReachable = await pingDb(c.env);
  return c.json({
    status: dbReachable ? 'ok' : 'degraded',
    environment: c.env.ENVIRONMENT,
    db: dbReachable ? 'reachable' : 'unreachable',
    time: new Date().toISOString(),
  });
});

app.get('/', (c) => c.text('superconnector'));

// MCP endpoint — its own auth header (MCP_SECRET).
app.all('/mcp', async (c) => handleMcp(c.env, c.req.raw));

// Web API — auth-gated. The SvelteKit Pages worker proxies all browser traffic
// server-to-server, so we don't expose any CORS allowance here. Direct browser
// calls from third-party origins are rejected by the same-origin policy.
app.use('/api/*', requireAuth);
app.route('/api/people', people);
app.route('/api/queue', queue);
app.route('/api/tags', tags);
app.route('/api/followups', followups);
app.route('/api/chat', chat);
app.route('/api/digest', digest);
app.route('/api/notes', notes);

// Manual triggers (auth-gated) for testing the cron paths.
app.post('/api/run/ingest', requireAuth, async (c) => {
  try {
    const result = await runIngest(c.env);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('ingest failed', message);
    return c.json({ error: message }, 500);
  }
});

// Manual trigger for the monthly D1 → R2 backup.
app.post('/api/run/backup', requireAuth, async (c) => {
  try {
    const result = await runBackup(c.env);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.post('/api/run/daily-email', requireAuth, async (c) => {
  try {
    await runDailyEmail(c.env);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('daily-email failed', message);
    return c.json({ error: message }, 500);
  }
});

// Admin: clean up phantom (unknown) people created before ingest hardening.
// People with no email, no name, and zero meetings are pure noise — delete them
// and any tags/signals/followups that referenced them.
app.post('/api/admin/cleanup-phantoms', requireAuth, async (c) => {
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
app.post('/api/admin/backfill-last-met', requireAuth, async (c) => {
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
  ).bind(new Date().toISOString()).run();
  return c.json({ ok: true, rows_updated: r.meta.changes ?? 0 });
});

// Admin: replace underscores with spaces (and lowercase) across every tag /
// trajectory_tag / role / tag_proposal in the DB. Idempotent. Run after the
// V fix to clean up historical data.
app.post('/api/admin/normalize-tags', requireAuth, async (c) => {
  const { normalizeTagName } = await import('./lib/tag_norm');
  const { parseJsonArray } = await import('./lib/db');

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
      // Move person_tags rows to the kept tag, ignoring rows that would
      // collide (person already has the canonical tag).
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

// Admin: delete meeting rows whose event_start (or recorded_at, when no
// event_start exists) is in the future. Granola pre-creates notes for
// upcoming calendar invites; before the future-event guard landed those
// could leak in as "past meetings". Cleans up the leak. Also recomputes
// last_met_date / meeting_count for affected people.
app.post('/api/admin/cleanup-future-meetings', requireAuth, async (c) => {
  const nowIso = new Date().toISOString();
  const found = await c.env.DB.prepare(
    `SELECT id, person_id FROM meetings
      WHERE (event_start IS NOT NULL AND event_start > ?1)
         OR (event_start IS NULL AND recorded_at > ?1)`,
  ).bind(nowIso).all<{ id: string; person_id: string | null }>();
  const rows = found.results ?? [];
  const personIds = new Set<string>();
  for (const r of rows) {
    if (r.person_id) personIds.add(r.person_id);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM signals WHERE meeting_id = ?1').bind(r.id),
      c.env.DB.prepare('DELETE FROM followups WHERE meeting_id = ?1').bind(r.id),
      c.env.DB.prepare('DELETE FROM meetings WHERE id = ?1').bind(r.id),
    ]);
  }
  // Recompute last_met_date / meeting_count for people whose meetings we just removed.
  for (const pid of personIds) {
    await c.env.DB.prepare(
      `UPDATE people SET
         last_met_date = (SELECT substr(MAX(recorded_at), 1, 10) FROM meetings WHERE person_id = ?1),
         meeting_count = (SELECT COUNT(*) FROM meetings WHERE person_id = ?1),
         updated_at = ?2
       WHERE id = ?1`,
    ).bind(pid, nowIso).run();
  }
  return c.json({ meetings_deleted: rows.length, people_recomputed: personIds.size });
});

// Admin: dismiss every pending queue item. Use after a logic change makes the
// existing pending items stale.
app.post('/api/admin/clear-queue', requireAuth, async (c) => {
  const r = await c.env.DB.prepare(
    `UPDATE confirmation_queue SET status = 'dismissed' WHERE status = 'pending'`,
  ).run();
  return c.json({ dismissed: r.meta.changes ?? 0 });
});

// Admin: reset the Granola high-water mark so the next ingest re-pulls notes.
// Existing meetings are kept; getExistingMeeting() skips them by source_ref
// unless the note's content hash has changed (which then triggers reprocess).
app.post('/api/admin/reset-ingest', requireAuth, async (c) => {
  await c.env.DB.prepare(`DELETE FROM ingest_state WHERE source = 'granola'`).run();
  return c.json({ ok: true });
});

// Admin: force a Granola sweep starting at `since` (ISO 8601). Use this after
// editing a batch of note titles in Granola — it ignores the high-water mark
// for one run, so every note >= since is checked for content changes and
// reprocessed in place. Cheaper than nuking the high-water mark.
app.post('/api/admin/repull-granola', requireAuth, async (c) => {
  const url = new URL(c.req.url);
  const since = url.searchParams.get('since') ?? '1970-01-01T00:00:00Z';
  try {
    const result = await runIngest(c.env, { forceSince: since });
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Diagnostic: parse the Proton ICS feed and report attendee/event stats so
// we can see whether ICS is actually contributing meaningful counterpart info.
app.get('/api/run/check-ics', requireAuth, async (c) => {
  if (!c.env.PROTON_ICS_URL) return c.json({ error: 'PROTON_ICS_URL not set' }, 500);
  try {
    const { fetchIcs } = await import('./lib/ics');
    const events = await fetchIcs(c.env.PROTON_ICS_URL);
    const me = (c.env.EMAIL_TO ?? '').toLowerCase();
    const now = Date.now();
    const recent = events.filter(
      (e) => e.start.getTime() > now - 90 * 24 * 60 * 60 * 1000 && e.start.getTime() < now,
    );
    const sortedByStart = [...events].sort((a, b) => a.start.getTime() - b.start.getTime());
    const stats = {
      total_events: events.length,
      events_last_90_days: recent.length,
      earliest_event_start: sortedByStart[0]?.start.toISOString() ?? null,
      latest_event_start: sortedByStart[sortedByStart.length - 1]?.start.toISOString() ?? null,
      with_any_attendees: recent.filter((e) => e.attendees.length > 0).length,
      with_others_attendees: recent.filter((e) =>
        e.attendees.some((a) => (a.email ?? '').toLowerCase() !== me),
      ).length,
      with_organizer: recent.filter((e) => e.organizer != null).length,
    };
    const samples = recent.slice(0, 5).map((e) => ({
      summary: e.summary,
      start: e.start.toISOString(),
      attendees: e.attendees,
      organizer: e.organizer,
    }));
    // For each queue item with no event match, try to match against ICS now to
    // see if it would match in a re-run.
    const noteParam = c.req.query('note_at');
    let manual_match: unknown = null;
    if (noteParam) {
      const noteAt = new Date(noteParam);
      const { eventsAround } = await import('./lib/ics');
      const candidates = eventsAround(events, noteAt, 30);
      manual_match = {
        note_at: noteAt.toISOString(),
        candidates: candidates.map((e) => ({
          summary: e.summary,
          start: e.start.toISOString(),
          end: e.end.toISOString(),
          attendees: e.attendees,
        })),
      };
    }
    // Bucket counts per month so we can see if the feed is a rolling window.
    const byMonth: Record<string, number> = {};
    for (const e of sortedByStart) {
      const k = e.start.toISOString().slice(0, 7);
      byMonth[k] = (byMonth[k] ?? 0) + 1;
    }
    return c.json({ stats, by_month: byMonth, samples, manual_match });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Diagnostic: test Granola API connectivity and show raw response shape.
// Pass ?id=<noteId> to fetch a single note (with all common include params)
// so we can see what summary-like field actually carries the meeting summary.
app.get('/api/run/check-granola', requireAuth, async (c) => {
  const key = c.env.GRANOLA_API_KEY;
  if (!key) return c.json({ error: 'GRANOLA_API_KEY not set' }, 500);
  const url = new URL(c.req.url);
  const id = url.searchParams.get('id');
  try {
    const targets = id
      ? [
          `https://public-api.granola.ai/v1/notes/${encodeURIComponent(id)}`,
          `https://public-api.granola.ai/v1/notes/${encodeURIComponent(id)}?include=transcript`,
          `https://public-api.granola.ai/v1/notes/${encodeURIComponent(id)}?include=summary`,
          `https://public-api.granola.ai/v1/notes/${encodeURIComponent(id)}?include=body`,
          `https://public-api.granola.ai/v1/notes/${encodeURIComponent(id)}?include=markdown`,
          `https://public-api.granola.ai/v1/notes/${encodeURIComponent(id)}?include=notes`,
        ]
      : ['https://public-api.granola.ai/v1/notes'];
    const out: Array<{ url: string; status: number; keys?: string[]; body?: unknown }> = [];
    for (const target of targets) {
      const resp = await fetch(target, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      });
      const text = await resp.text();
      let parsed: unknown;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      const keys = parsed && typeof parsed === 'object' ? Object.keys(parsed as object) : undefined;
      out.push({ url: target, status: resp.status, keys, body: parsed });
    }
    return c.json({ probes: out });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

async function pingDb(env: Env): Promise<boolean> {
  try {
    const result = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return result?.ok === 1;
  } catch {
    return false;
  }
}

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(event, env));
  },
} satisfies ExportedHandler<Env>;

async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  const cron = event.cron;
  if (cron === '*/5 * * * *') {
    const result = await runIngest(env);
    console.log('ingest', result);
    return;
  }
  if (cron === '0 13 * * *') {
    await runDailyEmail(env);
    return;
  }
  if (cron === '0 9 1 * *') {
    const result = await runBackup(env);
    console.log('backup', result);
    return;
  }
}
