// Read-only diagnostic endpoints. Used to inspect upstream-API shape and
// connectivity without redeploying debug code. All gated by /api/* auth.

import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { fetchIcs, eventsAround } from '../lib/ics';
import { asJson } from './errors';

const app = new Hono<{ Bindings: Env }>();

// Diagnostic: parse the Proton ICS feed and report attendee/event stats so
// we can see whether ICS is actually contributing meaningful counterpart info.
app.get(
  '/check-ics',
  asJson<{ Bindings: Env }>(async (c) => {
    if (!c.env.PROTON_ICS_URL) return c.json({ error: 'PROTON_ICS_URL not set' }, 500);
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
  }, 'check-ics'),
);

// Diagnostic: test Granola API connectivity and show raw response shape.
// Pass ?id=<noteId> to fetch a single note (with all common include params)
// so we can see what summary-like field actually carries the meeting summary.
app.get(
  '/check-granola',
  asJson<{ Bindings: Env }>(async (c) => {
    const key = c.env.GRANOLA_API_KEY;
    if (!key) return c.json({ error: 'GRANOLA_API_KEY not set' }, 500);
    const url = new URL(c.req.url);
    const id = url.searchParams.get('id');
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
  }, 'check-granola'),
);

export default app;
