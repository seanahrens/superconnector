-- Clean up duplicate confirmation_queue rows that point at the same Granola
-- note id. Earlier ingest paths only deduped by checking the `meetings`
-- table; notes that landed in the queue (not in meetings) could be re-queued
-- on every high-water-mark reset. Keep only the newest row per
-- (kind, note.id) regardless of status.
DELETE FROM confirmation_queue
 WHERE json_extract(payload, '$.note.id') IS NOT NULL
   AND id NOT IN (
     SELECT id FROM (
       SELECT id,
              ROW_NUMBER() OVER (
                PARTITION BY kind, json_extract(payload, '$.note.id')
                ORDER BY created_at DESC
              ) AS rn
         FROM confirmation_queue
        WHERE json_extract(payload, '$.note.id') IS NOT NULL
     ) WHERE rn = 1
   );

-- Partial unique index: at most one *pending* queue row per (kind, note.id).
-- Once an item is resolved/dismissed it can age out without blocking a future
-- legitimate re-queue if someone explicitly re-pulls the note.
CREATE UNIQUE INDEX uniq_queue_pending_note
  ON confirmation_queue (kind, json_extract(payload, '$.note.id'))
  WHERE status = 'pending'
    AND json_extract(payload, '$.note.id') IS NOT NULL;
