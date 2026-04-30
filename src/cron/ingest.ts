// 5-min cron: pull new Granola notes → match calendar → classify → resolve →
// extract → commit. ICS data lives only in RAM during the run.

import type { Env } from '../../worker-configuration';
import {
  GranolaClient,
  type GranolaNote,
  type GranolaAttendee,
  transcriptToString,
  isSoloNote,
  noteContentHash,
} from '../lib/granola';
import { fetchIcs, eventsAround, type IcsEvent } from '../lib/ics';
import { classifyMeeting, bestEventForNote, voteClassification } from '../lib/classify';
import { resolvePerson } from '../lib/resolve';
import { extractFromMeeting } from '../lib/extract';
import { applyExtractionResult } from '../lib/people_writes';
import { findMePerson, ensureMePerson } from '../lib/me';
import { materializeFromGranolaNote } from '../lib/queue_resolve';
import { recordDisposition, type Disposition } from '../lib/ingest_log';
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

// Returns true when a pending queue row already exists for this note +
// kind. Lets us skip a redundant INSERT instead of relying solely on the
// unique index (which would error and abort the whole transaction).
async function isAlreadyQueued(env: Env, kind: string, noteId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM confirmation_queue
      WHERE kind = ?1
        AND json_extract(payload, '$.note.id') = ?2
        AND status = 'pending'
      LIMIT 1`,
  ).bind(kind, noteId).first();
  return !!row;
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
  // Solo notes (personal brainstorming, no other attendees, no calendar event)
  // shouldn't enter the people graph at all — skip silently but log so the
  // user can see what was filtered.
  if (isSoloNote(note, env.EMAIL_TO ?? null)) {
    await logDisposition(env, note, 'skipped_solo', 'no other attendees and no calendar event', null, null);
    return 'skipped';
  }

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
    if (!(await isAlreadyQueued(env, 'meeting_classification', note.id))) {
      await env.DB.prepare(
        `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
         VALUES (?1, 'meeting_classification', ?2, 'pending', ?3)`,
      ).bind(
        // queued via meeting_classification
        ulid(),
        JSON.stringify({
          note: noteForQueue,
          event_title: eventTitle,
          attendees,
          classifier_reason: cls.reason,
        }),
        nowIso(),
      ).run();
      await logDisposition(env, note, 'queued', `meeting_classification: ${cls.reason}`, null, null);
    }
    return 'processed';
  }

  // 1:1 path. If we have no usable counterpart info, queue for person_resolution
  // rather than silently creating a phantom (unknown) row.
  const counterpart = attendees[0] ?? null;
  if (!counterpart || (!counterpart.email && !counterpart.name)) {
    if (!(await isAlreadyQueued(env, 'person_resolution', note.id))) {
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
      await logDisposition(env, note, 'queued', 'person_resolution: no attendee info', null, null);
    }
    return 'processed';
  }

  const resolved = await resolvePerson(env, {
    email: counterpart.email,
    name: counterpart.name,
  });
  if (resolved.ambiguous) {
    if (!(await isAlreadyQueued(env, 'person_resolution', note.id))) {
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
      await logDisposition(env, note, 'queued', 'person_resolution: ambiguous candidates', null, null);
    }
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
       attendees_at_match, transcript, summary, classification, created_at,
       source_content_hash, source_updated_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`,
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
    contentHash,
    note.updated_at ?? null,
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

  const me = await findMePerson(env);
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
    userPerson: me
      ? {
          displayName: me.display_name,
          context: me.context,
          needs: me.needs,
          offers: me.offers,
          roles: parseJsonArray(me.roles),
          trajectoryTags: parseJsonArray(me.trajectory_tags),
        }
      : undefined,
  });

  await applyExtractionResult(env, {
    personId: resolved.personId,
    meetingId,
    result,
    mePersonId: me?.id ?? null,
  });
  await logDisposition(env, note, 'processed', 'classifier 1:1 path', meetingId, resolved.personId);
  return 'processed';
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

  const userEmail = (env.EMAIL_TO ?? '').toLowerCase();
  const ownerEmail = (note.owner?.email ?? '').toLowerCase();
  const granolaPeople: GranolaAttendee[] =
    note.calendar_event?.attendees ?? note.attendees ?? [];

  let attendees: Array<{ email: string | null; name: string | null }> = [];
  let eventTitle: string | null = note.calendar_event?.summary ?? null;
  let eventStart: string | null = note.calendar_event?.start_time ?? null;
  let eventEnd: string | null = note.calendar_event?.end_time ?? null;

  const granolaOthers = granolaPeople.filter(
    (a) => a.email && a.email.toLowerCase() !== userEmail && a.email.toLowerCase() !== ownerEmail,
  );

  if (granolaOthers.length > 0) {
    attendees = granolaOthers.map((a) => ({ email: a.email ?? null, name: a.name ?? null }));
  } else {
    const recordedAt = new Date(note.created_at);
    const candidates = eventsAround(icsEventsAll, recordedAt, 15);
    const match = bestEventForNote(candidates, note.title);
    if (match.event) {
      const others = (match.event.attendees ?? []).filter(
        (a) => (a.email ?? '').toLowerCase() !== userEmail,
      );
      attendees = others.map((a) => ({ email: a.email ?? null, name: a.name ?? null }));
      eventTitle = match.event.summary ?? eventTitle;
      eventStart = match.event.start.toISOString();
      eventEnd = match.event.end.toISOString();
    }
  }

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
  await env.DB.prepare(
    `UPDATE meetings
     SET event_title = ?1, event_start = ?2, event_end = ?3,
         attendees_at_match = ?4, transcript = ?5, summary = ?6,
         classification = ?7, source_content_hash = ?8, source_updated_at = ?9
     WHERE id = ?10`,
  ).bind(
    eventTitle,
    eventStart,
    eventEnd,
    JSON.stringify(attendees),
    transcriptStr,
    note.summary,
    cls.classification,
    contentHash,
    note.updated_at ?? null,
    existing.id,
  ).run();

  if (classificationChanged || personChanged) {
    await env.DB.prepare(
      `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
       VALUES (?1, 'meeting_reclassification', ?2, 'pending', ?3)`,
    ).bind(
      ulid(),
      JSON.stringify({
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
      }),
      nowIso(),
    ).run();
    return 'reprocessed';
  }

  // Same classification + same person: re-run extraction and apply with the
  // reprocess flag (resets per-meeting signals, doesn't bump meeting_count).
  if (cls.classification !== '1:1') return 'reprocessed';

  const existingPerson = await env.DB.prepare(
    'SELECT display_name, context, needs, offers, roles, trajectory_tags FROM people WHERE id = ?1',
  ).bind(existing.person_id).first<{
    display_name: string | null;
    context: string | null;
    needs: string | null;
    offers: string | null;
    roles: string | null;
    trajectory_tags: string | null;
  }>();

  const me = await findMePerson(env);
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
    userPerson: me
      ? {
          displayName: me.display_name,
          context: me.context,
          needs: me.needs,
          offers: me.offers,
          roles: parseJsonArray(me.roles),
          trajectoryTags: parseJsonArray(me.trajectory_tags),
        }
      : undefined,
  });

  await applyExtractionResult(env, {
    personId: existing.person_id,
    meetingId: existing.id,
    result,
    reprocess: true,
    mePersonId: me?.id ?? null,
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
