// 5-min cron: pull new Granola notes → match calendar → classify → resolve →
// extract → commit. ICS data lives only in RAM during the run.

import type { Env } from '../../worker-configuration';
import { GranolaClient, type GranolaNote } from '../lib/granola';
import { fetchIcs, eventsAround, type IcsEvent } from '../lib/ics';
import { classifyMeeting, bestEventForNote } from '../lib/classify';
import { resolvePerson } from '../lib/resolve';
import { extractFromMeeting } from '../lib/extract';
import { applyExtractionResult } from '../lib/people_writes';
import { ulid, nowIso } from '../lib/ulid';

const SOURCE = 'granola';

export async function runIngest(env: Env): Promise<{ processed: number; skipped: number }> {
  const since = await getHighWaterMark(env);
  const granola = new GranolaClient(env.GRANOLA_API_KEY);
  const notes = await granola.listNotes({ since: since ?? undefined, limit: 50 });

  let icsEvents: IcsEvent[] | null = null;
  let lastRef = since;
  let processed = 0;
  let skipped = 0;

  for (const note of notes) {
    if (await isAlreadyIngested(env, note.id)) {
      skipped++;
      continue;
    }
    if (!icsEvents) {
      icsEvents = env.PROTON_ICS_URL ? await fetchIcs(env.PROTON_ICS_URL).catch(() => []) : [];
    }
    try {
      await processNote(env, note, icsEvents);
      processed++;
    } catch (err) {
      console.error('ingest error', { noteId: note.id, err: (err as Error).message });
    }
    if (!lastRef || note.recordedAt > lastRef) lastRef = note.recordedAt;
  }

  if (lastRef && lastRef !== since) await setHighWaterMark(env, lastRef);
  // ICS data falls out of scope here.
  return { processed, skipped };
}

async function processNote(env: Env, note: GranolaNote, events: IcsEvent[]): Promise<void> {
  const recordedAt = new Date(note.recordedAt);
  const candidates = eventsAround(events, recordedAt, 15);
  const { event, confidence } = bestEventForNote(candidates, note.title);

  const attendees = (event?.attendees ?? note.attendees ?? []).map((a) => ({
    email: a.email ?? null,
    name: a.name ?? null,
  }));

  const cls = await classifyMeeting(env, {
    noteTitle: note.title,
    noteSummary: note.summary,
    eventTitle: event?.summary ?? null,
    attendees,
  });

  // Group meetings: log the meeting against an empty placeholder? No — per plan v1
  // we skip group meetings entirely.
  if (cls.classification === 'group') return;

  if (cls.classification === 'ambiguous') {
    await env.DB.prepare(
      `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
       VALUES (?1, 'meeting_classification', ?2, 'pending', ?3)`,
    ).bind(
      ulid(),
      JSON.stringify({
        note,
        event_title: event?.summary ?? null,
        attendees,
        classifier_reason: cls.reason,
      }),
      nowIso(),
    ).run();
    return;
  }

  // 1:1: resolve the counterpart. Prefer the calendar attendee that isn't the user.
  const counterpart = pickCounterpart(attendees, env.EMAIL_TO);
  const resolved = await resolvePerson(env, {
    email: counterpart?.email ?? null,
    name: counterpart?.name ?? null,
  });
  if (resolved.ambiguous) {
    await env.DB.prepare(
      `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
       VALUES (?1, 'person_resolution', ?2, 'pending', ?3)`,
    ).bind(
      ulid(),
      JSON.stringify({ note, attendee: counterpart, candidates: resolved.candidatesIfAmbiguous }),
      nowIso(),
    ).run();
    return;
  }

  // Persist the meeting.
  const meetingId = ulid();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO meetings (
       id, person_id, source, source_ref, recorded_at, meeting_context,
       calendar_match_confidence, event_title, event_start, event_end,
       attendees_at_match, transcript, summary, classification, created_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`,
  ).bind(
    meetingId,
    resolved.personId,
    SOURCE,
    note.id,
    note.recordedAt,
    null,
    event ? confidence : null,
    event?.summary ?? null,
    event?.start.toISOString() ?? null,
    event?.end.toISOString() ?? null,
    JSON.stringify(attendees),
    note.transcript ?? null,
    note.summary ?? null,
    cls.classification,
    now,
  ).run();

  // Extract and apply.
  const existing = await env.DB.prepare(
    'SELECT display_name, context, needs, offers, roles, trajectory_tags FROM people WHERE id = ?1',
  ).bind(resolved.personId).first<{
    display_name: string | null;
    context: string | null;
    needs: string | null;
    offers: string | null;
    roles: string | null;
    trajectory_tags: string | null;
  }>();

  const result = await extractFromMeeting(env, {
    source: SOURCE,
    noteTitle: note.title,
    noteSummary: note.summary,
    transcript: note.transcript,
    existingPerson: existing
      ? {
          displayName: existing.display_name,
          context: existing.context,
          needs: existing.needs,
          offers: existing.offers,
          roles: parseJsonArrayLocal(existing.roles),
          trajectoryTags: parseJsonArrayLocal(existing.trajectory_tags),
        }
      : undefined,
  });

  await applyExtractionResult(env, { personId: resolved.personId, meetingId, result });
}

function pickCounterpart(
  attendees: Array<{ email: string | null; name: string | null }>,
  userEmail: string | undefined,
): { email: string | null; name: string | null } | null {
  if (attendees.length === 0) return null;
  const me = (userEmail ?? '').toLowerCase();
  const others = attendees.filter((a) => (a.email ?? '').toLowerCase() !== me);
  return others[0] ?? attendees[0] ?? null;
}

async function isAlreadyIngested(env: Env, sourceRef: string): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT id FROM meetings WHERE source = ?1 AND source_ref = ?2 LIMIT 1',
  ).bind(SOURCE, sourceRef).first();
  return !!row;
}

async function getHighWaterMark(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT last_processed_at FROM ingest_state WHERE source = ?1',
  ).bind(SOURCE).first<{ last_processed_at: string | null }>();
  return row?.last_processed_at ?? null;
}

async function setHighWaterMark(env: Env, ts: string): Promise<void> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO ingest_state (source, last_processed_at, last_processed_ref, updated_at)
     VALUES (?1, ?2, NULL, ?3)
     ON CONFLICT(source) DO UPDATE SET last_processed_at = excluded.last_processed_at, updated_at = excluded.updated_at`,
  ).bind(SOURCE, ts, now).run();
}

function parseJsonArrayLocal(s: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
