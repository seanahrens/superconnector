// 5-min cron: pull new Granola notes → match calendar → classify → resolve →
// extract → commit. ICS data lives only in RAM during the run.

import type { Env } from '../../worker-configuration';
import {
  GranolaClient,
  type GranolaNote,
  type GranolaAttendee,
  transcriptToString,
  isSoloNote,
  isFutureEventNote,
  noteContentHash,
} from '../lib/granola';
import { fetchIcs, eventsAround, type IcsEvent } from '../lib/ics';
import { classifyMeeting, bestEventForNote, voteClassification } from '../lib/classify';
import { resolvePerson } from '../lib/resolve';
import { extractFromMeeting } from '../lib/extract';
import { applyExtractionResult } from '../lib/people_writes';
import { ensureMePerson } from '../lib/me';
import { materializeFromGranolaNote } from '../lib/queue_resolve';
import { recordDisposition, type Disposition } from '../lib/ingest_log';
import { enqueueConfirmation, hasPendingForNote, type QueueKind } from '../lib/queue';
import { insertMeeting, updateMeetingFromNote } from '../lib/meetings';
import { loadExtractionPeerContext } from '../lib/extraction_context';
import { ulid, nowIso } from '../lib/ulid';

const SOURCE = 'granola';

export interface IngestOptions {
  // When set, ignore the high-water mark and pull every note created after
  // this ISO timestamp. Used by /api/admin/repull-granola to force a sweep
  // for note-edit reprocessing.
  forceSince?: string | null;
}

export async function runIngest(
  env: Env,
  opts: IngestOptions = {},
): Promise<{ processed: number; reprocessed: number; skipped: number }> {
  const since = opts.forceSince ?? (await getHighWaterMark(env));
  const granola = new GranolaClient(env.GRANOLA_API_KEY);
  const notes = await granola.listNotes({ created_after: since ?? undefined, limit: 50 });

  // Cold-start safety: make sure the "Me" row exists so [microphone] self-
  // statements have somewhere to land. Idempotent — no-op once it exists.
  await ensureMePerson(env, null).catch((err) =>
    console.error('ensureMePerson failed', (err as Error).message),
  );

  let icsEvents: IcsEvent[] | null = null;
  let lastRef = since;
  let processed = 0;
  let reprocessed = 0;
  let skipped = 0;

  for (const note of notes) {
    const existing = await getExistingMeeting(env, note.id);

    // Cheap pre-filter: if Granola tells us the note hasn't been edited since
    // we last saw it, skip without fetching the detail (saves a request and
    // an LLM call).
    if (
      existing &&
      note.updated_at &&
      existing.source_updated_at &&
      note.updated_at <= existing.source_updated_at
    ) {
      skipped++;
      if (!lastRef || note.created_at > lastRef) lastRef = note.created_at;
      continue;
    }

    if (!icsEvents) {
      icsEvents = env.PROTON_ICS_URL ? await fetchIcs(env.PROTON_ICS_URL).catch(() => []) : [];
    }
    try {
      const fullNote = await granola.getNote(note.id);
      const hash = await noteContentHash(fullNote);

      if (existing && existing.source_content_hash === hash) {
        // Content unchanged — just refresh the updated_at marker so the cheap
        // pre-filter catches it next time.
        if (fullNote.updated_at) {
          await env.DB.prepare(
            `UPDATE meetings SET source_updated_at = ?1 WHERE id = ?2`,
          ).bind(fullNote.updated_at, existing.id).run();
        }
        skipped++;
        if (!lastRef || note.created_at > lastRef) lastRef = note.created_at;
        continue;
      }

      const result = existing
        ? await reprocessNote(env, fullNote, icsEvents, existing, hash)
        : await processNote(env, fullNote, icsEvents, hash);
      if (result === 'processed') processed++;
      else if (result === 'reprocessed') reprocessed++;
      else skipped++;
    } catch (err) {
      console.error('ingest error', { noteId: note.id, err: (err as Error).message });
    }
    if (!lastRef || note.created_at > lastRef) lastRef = note.created_at;
  }

  if (lastRef && lastRef !== since && !opts.forceSince) {
    await setHighWaterMark(env, lastRef);
  }
  return { processed, reprocessed, skipped };
}

type ProcessOutcome = 'processed' | 'reprocessed' | 'skipped';

interface ResolvedAttendees {
  attendees: Array<{ email: string | null; name: string | null }>;
  eventTitle: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  /** 0..1 — confidence we have the right calendar attribution. */
  confidence: number;
}

// Pick the counterpart attendees and (when available) calendar event details
// for a note. Prefers Granola's own calendar_event.attendees; falls back to a
// time-window match against the user's ICS feed.
function resolveAttendees(
  env: Env,
  note: GranolaNote,
  icsEventsAll: IcsEvent[],
): ResolvedAttendees {
  const userEmail = (env.EMAIL_TO ?? '').toLowerCase();
  const ownerEmail = (note.owner?.email ?? '').toLowerCase();
  const granolaPeople: GranolaAttendee[] =
    note.calendar_event?.attendees ?? note.attendees ?? [];

  let eventTitle: string | null = note.calendar_event?.summary ?? null;
  let eventStart: string | null = note.calendar_event?.start_time ?? null;
  let eventEnd: string | null = note.calendar_event?.end_time ?? null;

  const granolaOthers = granolaPeople.filter(
    (a) => a.email && a.email.toLowerCase() !== userEmail && a.email.toLowerCase() !== ownerEmail,
  );

  if (granolaOthers.length > 0) {
    return {
      attendees: granolaOthers.map((a) => ({ email: a.email ?? null, name: a.name ?? null })),
      eventTitle,
      eventStart,
      eventEnd,
      confidence: 0.95,
    };
  }

  const candidates = eventsAround(icsEventsAll, new Date(note.created_at), 15);
  const match = bestEventForNote(candidates, note.title);
  if (!match.event) {
    return { attendees: [], eventTitle, eventStart, eventEnd, confidence: match.confidence };
  }

  const others = (match.event.attendees ?? []).filter(
    (a) => (a.email ?? '').toLowerCase() !== userEmail,
  );
  return {
    attendees: others.map((a) => ({ email: a.email ?? null, name: a.name ?? null })),
    eventTitle: match.event.summary ?? eventTitle,
    eventStart: match.event.start.toISOString(),
    eventEnd: match.event.end.toISOString(),
    confidence: match.confidence,
  };
}

// Compact view of a note suitable for the queue UI (no embedded transcript
// array; preview only).
function noteForQueuePayload(note: GranolaNote): Record<string, unknown> {
  return {
    id: note.id,
    title: note.title,
    web_url: note.web_url,
    owner: note.owner,
    created_at: note.created_at,
    summary: note.summary,
    transcript_preview: transcriptToString(note.transcript)?.slice(0, 1500) ?? null,
  };
}

async function queueNoteOnce(
  env: Env,
  kind: QueueKind,
  note: GranolaNote,
  payload: Record<string, unknown>,
  reason: string,
): Promise<void> {
  if (await hasPendingForNote(env, kind, note.id)) return;
  await enqueueConfirmation(env, kind, payload);
  await logDisposition(env, note, 'queued', `${kind}: ${reason}`, null, null);
}

async function logDisposition(
  env: Env,
  note: GranolaNote,
  disposition: Disposition,
  reason: string | null,
  meetingId: string | null,
  personId: string | null,
): Promise<void> {
  try {
    await recordDisposition(env, {
      source: SOURCE,
      source_ref: note.id,
      disposition,
      note_title: note.title ?? null,
      note_created_at: note.created_at ?? null,
      reason,
      meeting_id: meetingId,
      person_id: personId,
    });
  } catch (err) {
    console.error('ingest_log write failed', { noteId: note.id, err: (err as Error).message });
  }
}

async function processNote(
  env: Env,
  note: GranolaNote,
  icsEventsAll: IcsEvent[],
  contentHash: string,
): Promise<ProcessOutcome> {
  // Granola pre-creates notes for upcoming calendar events. We don't want
  // to register a "past meeting" for something that hasn't happened yet
  // (it leaks into recent-meeting widgets and last_met_date). Skip until
  // the event start time has passed; the note will be re-checked on a
  // subsequent ingest tick because we don't advance source_updated_at
  // for skipped rows.
  if (isFutureEventNote(note)) {
    await logDisposition(env, note, 'skipped_future', 'event has not started yet', null, null);
    return 'skipped';
  }

  // Solo notes (personal brainstorming, no other attendees, no calendar event)
  // shouldn't enter the people graph at all — skip silently but log so the
  // user can see what was filtered.
  if (isSoloNote(note, env.EMAIL_TO ?? null)) {
    await logDisposition(env, note, 'skipped_solo', 'no other attendees and no calendar event', null, null);
    return 'skipped';
  }

  const { attendees, eventTitle, eventStart, eventEnd, confidence } = resolveAttendees(env, note, icsEventsAll);

  // First try the cheap three-signal vote. With Granola Personal API
  // returning no real attendees and Proton ICS being a rolling window,
  // most notes used to fall through to the LLM and end up "ambiguous".
  // The vote inspects title patterns + transcript speaker count + ICS
  // attendees and only escalates to the LLM when none of those agree.
  const vote = voteClassification({
    noteTitle: note.title,
    noteSummary: note.summary,
    ownerName: note.owner?.name ?? null,
    transcriptTurns: note.transcript ?? null,
    attendees,
  });

  if (vote.classification === 'group') {
    console.log('ingest: skip group via vote', { noteId: note.id, reason: vote.reason });
    await logDisposition(env, note, 'skipped_group', vote.reason, null, null);
    return 'skipped';
  }

  // Confident 1:1 with a counterpart name → materialize directly.
  if (vote.classification === '1:1' && vote.confidence >= 0.7 && vote.counterpartName) {
    try {
      const result = await materializeFromGranolaNote(env, {
        noteId: note.id,
        classification: '1:1',
        counterpart: { name: vote.counterpartName },
      });
      console.log('ingest: auto-processed 1:1 via vote', {
        noteId: note.id,
        personId: result.personId,
        reason: vote.reason,
      });
      await logDisposition(env, note, 'processed', vote.reason, result.meetingId, result.personId);
      return 'processed';
    } catch (err) {
      // Fall through to the LLM path / queue if materialization fails (e.g.
      // resolvePerson returned ambiguous candidates). Don't lose the note.
      console.error('ingest: vote-driven materialize failed, falling back', {
        noteId: note.id,
        err: (err as Error).message,
      });
    }
  }

  const cls = await classifyMeeting(env, {
    noteTitle: note.title,
    noteSummary: note.summary,
    eventTitle,
    attendees,
  });

  if (cls.classification === 'group') {
    await logDisposition(env, note, 'skipped_group', cls.reason ?? 'classifier said group', null, null);
    return 'skipped';
  }

  if (cls.classification === 'ambiguous') {
    await queueNoteOnce(env, 'meeting_classification', note, {
      note: noteForQueuePayload(note),
      event_title: eventTitle,
      attendees,
      classifier_reason: cls.reason,
    }, cls.reason ?? 'classifier said ambiguous');
    return 'processed';
  }

  // 1:1 path. If we have no usable counterpart info, queue for person_resolution
  // rather than silently creating a phantom (unknown) row.
  const counterpart = attendees[0] ?? null;
  if (!counterpart || (!counterpart.email && !counterpart.name)) {
    await queueNoteOnce(env, 'person_resolution', note, {
      note: noteForQueuePayload(note),
      attendee: null,
      candidates: [],
      reason: 'no usable attendee info from Granola or ICS',
    }, 'no attendee info');
    return 'processed';
  }

  const resolved = await resolvePerson(env, {
    email: counterpart.email,
    name: counterpart.name,
  });
  if (resolved.ambiguous) {
    await queueNoteOnce(env, 'person_resolution', note, {
      note: noteForQueuePayload(note),
      attendee: counterpart,
      candidates: resolved.candidatesIfAmbiguous,
    }, 'ambiguous candidates');
    return 'processed';
  }

  // Persist meeting (transcript folded to a single string).
  const transcriptStr = transcriptToString(note.transcript);
  const meetingId = await persistMeeting(env, {
    note,
    personId: resolved.personId,
    attendees,
    eventTitle,
    eventStart,
    eventEnd,
    confidence,
    classification: cls.classification,
    transcript: transcriptStr,
    contentHash,
  });

  await runExtractionAndApply(env, {
    note,
    personId: resolved.personId,
    meetingId,
    transcript: transcriptStr,
  });
  await logDisposition(env, note, 'processed', 'classifier 1:1 path', meetingId, resolved.personId);
  return 'processed';
}

interface PersistMeetingArgs {
  note: GranolaNote;
  personId: string;
  attendees: Array<{ email: string | null; name: string | null }>;
  eventTitle: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  confidence: number;
  classification: string;
  transcript: string | null;
  contentHash: string;
}

async function persistMeeting(env: Env, a: PersistMeetingArgs): Promise<string> {
  const meetingId = ulid();
  await insertMeeting(env, {
    id: meetingId,
    personId: a.personId,
    source: SOURCE,
    sourceRef: a.note.id,
    recordedAt: a.note.created_at,
    calendarMatchConfidence: a.confidence || null,
    eventTitle: a.eventTitle,
    eventStart: a.eventStart,
    eventEnd: a.eventEnd,
    attendees: a.attendees,
    transcript: a.transcript,
    summary: a.note.summary,
    classification: a.classification,
    sourceContentHash: a.contentHash,
    sourceUpdatedAt: a.note.updated_at ?? null,
  });
  return meetingId;
}

interface ExtractAndApplyArgs {
  note: GranolaNote;
  personId: string;
  meetingId: string;
  transcript: string | null;
  reprocess?: boolean;
}

async function runExtractionAndApply(env: Env, a: ExtractAndApplyArgs): Promise<void> {
  const ctx = await loadExtractionPeerContext(env, a.personId);
  const result = await extractFromMeeting(env, {
    source: SOURCE,
    noteTitle: a.note.title,
    noteSummary: a.note.summary,
    transcript: a.transcript,
    existingPerson: ctx.existingPerson,
    userPerson: ctx.userPerson,
  });
  await applyExtractionResult(env, {
    personId: a.personId,
    meetingId: a.meetingId,
    result,
    reprocess: a.reprocess,
    meetingRecordedAt: a.note.created_at,
    mePersonId: ctx.mePersonId,
  });
}

interface ExistingMeeting {
  id: string;
  person_id: string;
  classification: string;
  source_content_hash: string | null;
  source_updated_at: string | null;
}

async function getExistingMeeting(env: Env, sourceRef: string): Promise<ExistingMeeting | null> {
  return await env.DB.prepare(
    `SELECT id, person_id, classification, source_content_hash, source_updated_at
     FROM meetings WHERE source = ?1 AND source_ref = ?2 LIMIT 1`,
  ).bind(SOURCE, sourceRef).first<ExistingMeeting>();
}

// Re-apply a Granola note whose content has changed since the last ingest.
// Refreshes the meeting row, then either re-extracts in place or queues a
// `meeting_reclassification` item if the classification or counterpart has
// changed (we don't silently re-route a meeting to a different person — that
// would destroy provenance for any signals derived from it).
async function reprocessNote(
  env: Env,
  note: GranolaNote,
  icsEventsAll: IcsEvent[],
  existing: ExistingMeeting,
  contentHash: string,
): Promise<ProcessOutcome> {
  if (isSoloNote(note, env.EMAIL_TO ?? null)) return 'skipped';

  const { attendees, eventTitle, eventStart, eventEnd } = resolveAttendees(env, note, icsEventsAll);

  const cls = await classifyMeeting(env, {
    noteTitle: note.title,
    noteSummary: note.summary,
    eventTitle,
    attendees,
  });

  // Detect a structural change. If classification flipped (e.g. ambiguous → 1:1
  // after a title edit) or the counterpart resolves to a different person,
  // surface this in the queue rather than silently re-routing.
  const counterpart = attendees[0] ?? null;
  let resolvedPersonId: string | null = null;
  if (counterpart && (counterpart.email || counterpart.name)) {
    const r = await resolvePerson(env, { email: counterpart.email, name: counterpart.name });
    if (!r.ambiguous) resolvedPersonId = r.personId;
  }

  const classificationChanged = cls.classification !== existing.classification;
  const personChanged = resolvedPersonId !== null && resolvedPersonId !== existing.person_id;
  const transcriptStr = transcriptToString(note.transcript);

  // Always refresh the stored content even if classification flipped; the
  // queue item below explains the conflict.
  await updateMeetingFromNote(env, {
    id: existing.id,
    eventTitle,
    eventStart,
    eventEnd,
    attendees,
    transcript: transcriptStr,
    summary: note.summary,
    classification: cls.classification,
    sourceContentHash: contentHash,
    sourceUpdatedAt: note.updated_at ?? null,
  });

  if (classificationChanged || personChanged) {
    await enqueueConfirmation(env, 'meeting_reclassification', {
      meeting_id: existing.id,
      previous_classification: existing.classification,
      previous_person_id: existing.person_id,
      new_classification: cls.classification,
      new_resolved_person_id: resolvedPersonId,
      attendees,
      note: {
        id: note.id,
        title: note.title,
        web_url: note.web_url,
        summary: note.summary,
        transcript_preview: transcriptStr?.slice(0, 1500) ?? null,
      },
      classifier_reason: cls.reason,
    });
    return 'reprocessed';
  }

  // Same classification + same person: re-run extraction and apply with the
  // reprocess flag (resets per-meeting signals, doesn't bump meeting_count).
  if (cls.classification !== '1:1') return 'reprocessed';

  await runExtractionAndApply(env, {
    note,
    personId: existing.person_id,
    meetingId: existing.id,
    transcript: transcriptStr,
    reprocess: true,
  });
  return 'reprocessed';
}

async function getHighWaterMark(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT last_processed_at FROM ingest_state WHERE source = ?1',
  ).bind(SOURCE).first<{ last_processed_at: string | null }>();
  return row?.last_processed_at ?? null;
}

async function setHighWaterMark(env: Env, ts: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO ingest_state (source, last_processed_at, last_processed_ref, updated_at)
     VALUES (?1, ?2, NULL, ?3)
     ON CONFLICT(source) DO UPDATE SET last_processed_at = excluded.last_processed_at, updated_at = excluded.updated_at`,
  ).bind(SOURCE, ts, nowIso()).run();
}
