// Per-note ingest disposition log. Records what we did with each Granola
// note so the UI's "Skipped" tab can show what would otherwise vanish
// silently (group meetings, solo notes, errors).

import type { Env } from '../../worker-configuration';
import { nowIso } from './ulid';

export type Disposition =
  | 'processed'
  | 'skipped_solo'
  | 'skipped_group'
  | 'queued'
  | 'errored'
  | 'reprocessed';

export interface LogEntry {
  source: string;
  source_ref: string;
  disposition: Disposition;
  note_title?: string | null;
  note_created_at?: string | null;
  reason?: string | null;
  meeting_id?: string | null;
  person_id?: string | null;
}

export async function recordDisposition(env: Env, e: LogEntry): Promise<void> {
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO ingest_log (
       source, source_ref, disposition, note_title, note_created_at,
       reason, meeting_id, person_id, created_at, updated_at
     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)
     ON CONFLICT(source, source_ref) DO UPDATE SET
       disposition = excluded.disposition,
       note_title = excluded.note_title,
       note_created_at = excluded.note_created_at,
       reason = excluded.reason,
       meeting_id = excluded.meeting_id,
       person_id = excluded.person_id,
       updated_at = excluded.updated_at`,
  ).bind(
    e.source,
    e.source_ref,
    e.disposition,
    e.note_title ?? null,
    e.note_created_at ?? null,
    e.reason ?? null,
    e.meeting_id ?? null,
    e.person_id ?? null,
    now,
  ).run();
}
