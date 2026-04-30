-- Per-note record of what ingest decided. Lets the UI show a "Skipped" tab
-- so silent skips (group meetings, solo notes) aren't invisible. One row per
-- note id; updated in place when a re-ingest changes the disposition.

CREATE TABLE ingest_log (
  source TEXT NOT NULL,
  source_ref TEXT NOT NULL,
  disposition TEXT NOT NULL,        -- 'processed' | 'skipped_solo' | 'skipped_group' | 'queued' | 'errored' | 'reprocessed'
  note_title TEXT,
  note_created_at TEXT,
  reason TEXT,
  meeting_id TEXT,
  person_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source, source_ref)
);

CREATE INDEX idx_ingest_log_disposition ON ingest_log(disposition);
CREATE INDEX idx_ingest_log_note_created_at ON ingest_log(note_created_at DESC);
