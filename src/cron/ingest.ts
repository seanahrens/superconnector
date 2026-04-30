// 5-min cron: pull new Granola notes → match calendar → classify → resolve →
// extract → commit. ICS data lives only in RAM during the run.

import type { Env } from '../../worker-configuration';
import {
  GranolaClient,
  type GranolaNote,
  type GranolaAttendee,
  transcriptToString,
  isSoloNote,
} from '../lib/granola';
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
  const notes = await granola.listNotes({ created_after: since ?? undefined, limit: 50 });

  let icsEvents: IcsEvent[] | null = null;
  let lastRef = since;
  let processed = 0;
  let skipped = 0;

  for (const note of notes) {
    if (await isAlreadyIngested(env, note.id)) {
      skipped++;
      if (!lastRef || note.created_at > lastRef) lastRef = note.created_at;
      continue;
    }
    if (!icsEvents) {
      icsEvents = env.PROTON_ICS_URL ? await fetchIcs(env.PROTON_ICS_URL).catch(() => []) : [];
    }
    try {
      const fullNote = await granola.getNote(note.id);
      const result = await processNote(env, fullNote, icsEvents);
      if (result === 'processed') processed++;
      else skipped++;
    } catch (err) {
      console.error('ingest error', { noteId: note.id, err: (err as Error).message });
    }
    if (!lastRef || note.created_at > lastRef) lastRef = note.created_at;
  }

  if (lastRef && lastRef !== since) await setHighWaterMark(env, lastRef);
  return { processed, skipped };
}

type ProcessOutcome = 'processed' | 'skipped';

async function processNote(
  env: Env,
  note: GranolaNote,
  icsEventsAll: IcsEvent[],
): Promise<ProcessOutcome> {
  // Solo notes (personal brainstorming, no other attendees, no calendar event)
  // shouldn't enter the people graph at all — skip silently.
  if (isSoloNote(note, env.EMAIL_TO ?? null)) return 'skipped';

  // Prefer Granola's own calendar_event.attendees when present (high confidence,
  // attribution from the meeting source). Fall back to ICS time-window match.
  const userEmail = (env.EMAIL_TO ?? '').toLowerCase();
  const ownerEmail = (note.owner?.email ?? '').toLowerCase();

  const granolaPeople: GranolaAttendee[] =
    note.calendar_event?.attendees ?? note.attendees ?? [];

  let icsEvent: IcsEvent | null = null;
  let calendarConfidence = 0;
  let attendees: Array<{ email: string | null; name: string | null }> = [];
  let eventTitle: string | null = note.calendar_event?.summary ?? null;
  let eventStart: string | null = note.calendar_event?.start_time ?? null;
  let eventEnd: string | null = note.calendar_event?.end_time ?? null;

  const granolaOthers = granolaPeople.filter(
    (a) => a.email && a.email.toLowerCase() !== userEmail && a.email.toLowerCase() !== ownerEmail,
  );

  if (granolaOthers.length > 0) {
    attendees = granolaOthers.map((a) => ({ email: a.email ?? null, name: a.name ?? null }));
    calendarConfidence = 0.95;
  } else {
    const recordedAt = new Date(note.created_at);
    const candidates = eventsAround(icsEventsAll, recordedAt, 15);
    const match = bestEventForNote(candidates, note.title);
    icsEvent = match.event;
    calendarConfidence = match.confidence;
    if (icsEvent) {
      const others = (icsEvent.attendees ?? []).filter(
        (a) => (a.email ?? '').toLowerCase() !== userEmail,
      );
      attendees = others.map((a) => ({ email: a.email ?? null, name: a.name ?? null }));
      eventTitle = icsEvent.summary ?? eventTitle;
      eventStart = icsEvent.start.toISOString();
      eventEnd = icsEvent.end.toISOString();
    }
  }

  const cls = await classifyMeeting(env, {
    noteTitle: note.title,
    noteSummary: note.summary,
    eventTitle,
    attendees,
  });

  if (cls.classification === 'group') return 'skipped';

  // Stash a compact view of the note for the queue UI (no embedded transcript array).
  const noteForQueue = {
    id: note.id,
    title: note.title,
    web_url: note.web_url,
    owner: note.owner,
    created_at: note.created_at,
    summary: note.summary,
    transcript_preview: transcriptToString(note.transcript)?.slice(0, 1500) ?? null,
  };

  if (cls.classification === 'ambiguous') {
    await env.DB.prepare(
      `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
       VALUES (?1, 'meeting_classification', ?2, 'pending', ?3)`,
    ).bind(
      ulid(),
      JSON.stringify({
        note: noteForQueue,
        event_title: eventTitle,
        attendees,
        classifier_reason: cls.reason,
      }),
      nowIso(),
    ).run();
    return 'processed';
  }

  // 1:1 path. If we have no usable counterpart info, queue for person_resolution
  // rather than silently creating a phantom (unknown) row.
  const counterpart = attendees[0] ?? null;
  if (!counterpart || (!counterpart.email && !counterpart.name)) {
    await env.DB.prepare(
      `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
       VALUES (?1, 'person_resolution', ?2, 'pending', ?3)`,
    ).bind(
      ulid(),
      JSON.stringify({
        note: noteForQueue,
        attendee: null,
        candidates: [],
        reason: 'no usable attendee info from Granola or ICS',
      }),
      nowIso(),
    ).run();
    return 'processed';
  }

  const resolved = await resolvePerson(env, {
    email: counterpart.email,
    name: counterpart.name,
  });
  if (resolved.ambiguous) {
    await env.DB.prepare(
      `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
       VALUES (?1, 'person_resolution', ?2, 'pending', ?3)`,
    ).bind(
      ulid(),
      JSON.stringify({
        note: noteForQueue,
        attendee: counterpart,
        candidates: resolved.candidatesIfAmbiguous,
      }),
      nowIso(),
    ).run();
    return 'processed';
  }

  // Persist meeting (transcript folded to a single string).
  const transcriptStr = transcriptToString(note.transcript);
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
    note.created_at,
    null,
    calendarConfidence || null,
    eventTitle,
    eventStart,
    eventEnd,
    JSON.stringify(attendees),
    transcriptStr,
    note.summary,
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
    transcript: transcriptStr,
    existingPerson: existing
      ? {
          displayName: existing.display_name,
          context: existing.context,
          needs: existing.needs,
          offers: existing.offers,
          roles: parseJsonArray(existing.roles),
          trajectoryTags: parseJsonArray(existing.trajectory_tags),
        }
      : undefined,
  });

  await applyExtractionResult(env, { personId: resolved.personId, meetingId, result });
  return 'processed';
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

function parseJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}
