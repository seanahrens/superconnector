// confirmation_queue helpers. Two writers share an insert path
// (cron/ingest, api/queue) and one reader checks for an existing pending
// item by note id; pulling them together prevents drift in the SQL.

import type { Env } from '../../worker-configuration';
import { ulid, nowIso } from './ulid';

export type QueueKind =
  | 'meeting_classification'
  | 'meeting_reclassification'
  | 'person_resolution'
  | 'extraction_review';

export async function enqueueConfirmation(
  env: Env,
  kind: QueueKind | string,
  payload: unknown,
): Promise<string> {
  const id = ulid();
  await env.DB.prepare(
    `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
     VALUES (?1, ?2, ?3, 'pending', ?4)`,
  ).bind(id, kind, JSON.stringify(payload), nowIso()).run();
  return id;
}

// True when a pending queue row already exists for this note + kind. Lets
// callers skip a redundant INSERT instead of relying solely on the unique
// index (which would error and abort the surrounding transaction).
export async function hasPendingForNote(
  env: Env,
  kind: QueueKind | string,
  noteId: string,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM confirmation_queue
      WHERE kind = ?1
        AND json_extract(payload, '$.note.id') = ?2
        AND status = 'pending'
      LIMIT 1`,
  ).bind(kind, noteId).first();
  return !!row;
}

export async function setQueueStatus(
  env: Env,
  id: string,
  status: 'pending' | 'resolved' | 'dismissed',
): Promise<void> {
  await env.DB.prepare(
    `UPDATE confirmation_queue SET status = ?1 WHERE id = ?2`,
  ).bind(status, id).run();
}
