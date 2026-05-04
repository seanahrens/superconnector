// `meetings` table helpers. The full INSERT lived inline in three places
// (ingest.processNote, queue_resolve.materialize, plus the schema-mirroring
// UPDATE in ingest.reprocessNote); centralizing them here keeps the column
// list correct in one place.

import type { Env } from '../../worker-configuration';
import type { AttendeeRef } from './db';
import { nowIso } from './ulid';

export interface MeetingInsert {
  id: string;
  personId: string;
  source: string;
  sourceRef: string;
  recordedAt: string;
  meetingContext?: string | null;
  calendarMatchConfidence?: number | null;
  eventTitle?: string | null;
  eventStart?: string | null;
  eventEnd?: string | null;
  attendees: AttendeeRef[];
  transcript: string | null;
  summary: string | null;
  classification: string;
  sourceContentHash?: string | null;
  sourceUpdatedAt?: string | null;
}

export async function insertMeeting(env: Env, m: MeetingInsert): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO meetings (
       id, person_id, source, source_ref, recorded_at, meeting_context,
       calendar_match_confidence, event_title, event_start, event_end,
       attendees_at_match, transcript, summary, classification, created_at,
       source_content_hash, source_updated_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)`,
  ).bind(
    m.id,
    m.personId,
    m.source,
    m.sourceRef,
    m.recordedAt,
    m.meetingContext ?? null,
    m.calendarMatchConfidence ?? null,
    m.eventTitle ?? null,
    m.eventStart ?? null,
    m.eventEnd ?? null,
    JSON.stringify(m.attendees),
    m.transcript,
    m.summary,
    m.classification,
    nowIso(),
    m.sourceContentHash ?? null,
    m.sourceUpdatedAt ?? null,
  ).run();
}

export interface MeetingUpdate {
  id: string;
  eventTitle: string | null;
  eventStart: string | null;
  eventEnd: string | null;
  attendees: AttendeeRef[];
  transcript: string | null;
  summary: string | null;
  classification: string;
  sourceContentHash: string | null;
  sourceUpdatedAt: string | null;
}

export async function updateMeetingFromNote(env: Env, m: MeetingUpdate): Promise<void> {
  await env.DB.prepare(
    `UPDATE meetings
     SET event_title = ?1, event_start = ?2, event_end = ?3,
         attendees_at_match = ?4, transcript = ?5, summary = ?6,
         classification = ?7, source_content_hash = ?8, source_updated_at = ?9
     WHERE id = ?10`,
  ).bind(
    m.eventTitle,
    m.eventStart,
    m.eventEnd,
    JSON.stringify(m.attendees),
    m.transcript,
    m.summary,
    m.classification,
    m.sourceContentHash,
    m.sourceUpdatedAt,
    m.id,
  ).run();
}

export async function findMeetingBySourceRef(
  env: Env,
  source: string,
  sourceRef: string,
): Promise<{ id: string; person_id: string } | null> {
  return await env.DB.prepare(
    `SELECT id, person_id FROM meetings WHERE source = ?1 AND source_ref = ?2 LIMIT 1`,
  ).bind(source, sourceRef).first<{ id: string; person_id: string }>();
}

// Recompute last_met_date and meeting_count for a single person from the
// meetings table. Used by admin endpoints that delete meetings and by the
// merge path. Idempotent.
export async function recomputePersonMeetingStats(
  env: Env,
  personId: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE people SET
       last_met_date = (SELECT substr(MAX(recorded_at), 1, 10) FROM meetings WHERE person_id = ?1),
       meeting_count = (SELECT COUNT(*) FROM meetings WHERE person_id = ?1),
       updated_at = ?2
     WHERE id = ?1`,
  ).bind(personId, nowIso()).run();
}
