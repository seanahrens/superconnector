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
import { GranolaClient, transcriptToString, noteContentHash, isFutureEventNote } from './granola';
import { resolvePerson } from './resolve';
import { extractFromMeeting } from './extract';
import { applyExtractionResult } from './people_writes';
import { ulid } from './ulid';
import { insertMeeting, findMeetingBySourceRef } from './meetings';
import { loadExtractionPeerContext } from './extraction_context';

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
  if (isFutureEventNote(note)) {
    throw new Error('cannot materialize: this note is bound to an upcoming calendar event that has not occurred yet');
  }

  // If the note has already been turned into a meeting (e.g. the user
  // resolved twice), reuse it.
  const existing = await findMeetingBySourceRef(env, SOURCE, opts.noteId);
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

  // Best-effort attendees JSON: prefer calendar_event.attendees, else the
  // single counterpart we resolved against.
  const calAttendees = note.calendar_event?.attendees ?? [];
  const attendees =
    calAttendees.length > 0
      ? calAttendees.map((a) => ({ email: a.email ?? null, name: a.name ?? null }))
      : opts.counterpart
      ? [{ email: opts.counterpart.email ?? null, name: opts.counterpart.name ?? null }]
      : [];

  await insertMeeting(env, {
    id: meetingId,
    personId,
    source: SOURCE,
    sourceRef: note.id,
    recordedAt: note.created_at,
    eventTitle: note.calendar_event?.summary ?? null,
    eventStart: note.calendar_event?.start_time ?? null,
    eventEnd: note.calendar_event?.end_time ?? null,
    attendees,
    transcript: transcriptStr,
    summary: note.summary,
    classification: opts.classification,
    sourceContentHash: hash,
    sourceUpdatedAt: note.updated_at ?? null,
  });

  if (opts.classification !== '1:1') {
    return { meetingId, personId, reused: false };
  }

  const ctx = await loadExtractionPeerContext(env, personId);
  const result = await extractFromMeeting(env, {
    source: SOURCE,
    noteTitle: note.title,
    noteSummary: note.summary,
    transcript: transcriptStr,
    existingPerson: ctx.existingPerson,
    userPerson: ctx.userPerson,
  });

  await applyExtractionResult(env, {
    personId,
    meetingId,
    result,
    meetingRecordedAt: note.created_at,
    mePersonId: ctx.mePersonId,
  });
  return { meetingId, personId, reused: false };
}
