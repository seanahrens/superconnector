// Materialize a Granola-derived queue item into a real meeting + person.
//
// When a user resolves a `meeting_classification` or `person_resolution` queue
// item, the existing intercept in src/cron/ingest.ts has already been
// short-circuited (we put the note in the queue instead of producing a
// meetings row). This module finishes the work the cron stopped doing:
//  - re-fetches the full Granola note (the queue payload only has a 1.5K
//    transcript preview),
//  - resolves the counterpart to a person (or creates one),
//  - inserts the meetings row with the canonical content hash,
//  - runs Haiku extraction and applies the result to the person.

import type { Env } from '../../worker-configuration';
import { GranolaClient, transcriptToString, noteContentHash } from './granola';
import { resolvePerson } from './resolve';
import { extractFromMeeting } from './extract';
import { applyExtractionResult } from './people_writes';
import { ulid, nowIso } from './ulid';
import { parseJsonArray } from './db';

const SOURCE = 'granola';

export interface MaterializeOptions {
  noteId: string;
  classification: '1:1' | 'group' | 'ambiguous';
  // Either an existing person id, or counterpart info we should resolve.
  personId?: string;
  counterpart?: { name?: string | null; email?: string | null };
}

export interface MaterializeResult {
  meetingId: string;
  personId: string;
  reused: boolean;
}

export async function materializeFromGranolaNote(
  env: Env,
  opts: MaterializeOptions,
): Promise<MaterializeResult> {
  const granola = new GranolaClient(env.GRANOLA_API_KEY);
  const note = await granola.getNote(opts.noteId);

  // If the note has already been turned into a meeting (e.g. the user
  // resolved twice), reuse it.
  const existing = await env.DB.prepare(
    `SELECT id, person_id FROM meetings WHERE source = ?1 AND source_ref = ?2 LIMIT 1`,
  ).bind(SOURCE, opts.noteId).first<{ id: string; person_id: string }>();
  if (existing) return { meetingId: existing.id, personId: existing.person_id, reused: true };

  let personId = opts.personId;
  if (!personId) {
    const r = await resolvePerson(env, {
      email: opts.counterpart?.email ?? null,
      name: opts.counterpart?.name ?? null,
    });
    if (r.ambiguous) {
      throw new Error('counterpart resolution is ambiguous; pick a specific person');
    }
    personId = r.personId;
  }

  const transcriptStr = transcriptToString(note.transcript);
  const hash = await noteContentHash(note);
  const meetingId = ulid();
  const now = nowIso();
  const eventTitle = note.calendar_event?.summary ?? null;
  const eventStart = note.calendar_event?.start_time ?? null;
  const eventEnd = note.calendar_event?.end_time ?? null;

  // Best-effort attendees JSON: prefer calendar_event.attendees, else the
  // single counterpart we resolved against.
  const calAttendees = note.calendar_event?.attendees ?? [];
  const attendeesJson =
    calAttendees.length > 0
      ? calAttendees.map((a) => ({ email: a.email ?? null, name: a.name ?? null }))
      : opts.counterpart
      ? [{ email: opts.counterpart.email ?? null, name: opts.counterpart.name ?? null }]
      : [];

  await env.DB.prepare(
    `INSERT INTO meetings (
       id, person_id, source, source_ref, recorded_at, meeting_context,
       calendar_match_confidence, event_title, event_start, event_end,
       attendees_at_match, transcript, summary, classification, created_at,
       source_content_hash, source_updated_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`,
  ).bind(
    meetingId,
    personId,
    SOURCE,
    note.id,
    note.created_at,
    null,
    null,
    eventTitle,
    eventStart,
    eventEnd,
    JSON.stringify(attendeesJson),
    transcriptStr,
    note.summary,
    opts.classification,
    now,
    hash,
    note.updated_at ?? null,
  ).run();

  if (opts.classification !== '1:1') {
    return { meetingId, personId, reused: false };
  }

  const existingPerson = await env.DB.prepare(
    'SELECT display_name, context, needs, offers, roles, trajectory_tags FROM people WHERE id = ?1',
  ).bind(personId).first<{
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
    existingPerson: existingPerson
      ? {
          displayName: existingPerson.display_name,
          context: existingPerson.context,
          needs: existingPerson.needs,
          offers: existingPerson.offers,
          roles: parseJsonArray(existingPerson.roles),
          trajectoryTags: parseJsonArray(existingPerson.trajectory_tags),
        }
      : undefined,
  });

  await applyExtractionResult(env, { personId, meetingId, result });
  return { meetingId, personId, reused: false };
}
