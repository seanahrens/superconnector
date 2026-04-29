-- Superconnector core schema.
-- See plan: /root/.claude/plans/yes-please-create-a-joyful-horizon.md

PRAGMA foreign_keys = ON;

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  primary_email TEXT UNIQUE,
  display_name TEXT,
  aliases TEXT,                     -- JSON array
  roles TEXT,                       -- JSON array
  trajectory_tags TEXT,             -- JSON array
  status TEXT,                      -- JSON object
  geo TEXT,
  context TEXT,
  needs TEXT,
  offers TEXT,
  last_met_date TEXT,
  follow_up_due_date TEXT,
  meeting_count INTEGER NOT NULL DEFAULT 0,
  custom_sort_position TEXT,
  context_manual_override INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_people_last_met_date ON people(last_met_date DESC);
CREATE INDEX idx_people_meeting_count ON people(meeting_count DESC);
CREATE INDEX idx_people_custom_sort_position ON people(custom_sort_position);

CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  source TEXT NOT NULL,             -- 'granola' | 'user_dictation' | 'manual'
  source_ref TEXT,                  -- e.g. Granola note id
  recorded_at TEXT NOT NULL,
  meeting_context TEXT,
  calendar_match_confidence REAL,
  event_title TEXT,
  event_start TEXT,
  event_end TEXT,
  attendees_at_match TEXT,          -- JSON array of {email, name}
  transcript TEXT,
  summary TEXT,
  classification TEXT NOT NULL,     -- '1:1' | 'group' | 'ambiguous'
  created_at TEXT NOT NULL
);

CREATE INDEX idx_meetings_person_id ON meetings(person_id);
CREATE INDEX idx_meetings_recorded_at ON meetings(recorded_at DESC);
CREATE UNIQUE INDEX idx_meetings_source_ref ON meetings(source, source_ref)
  WHERE source_ref IS NOT NULL;

CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,               -- 'need' | 'offer' | 'status_change' | 'commitment' | 'note'
  body TEXT NOT NULL,
  confidence REAL,
  superseded_by TEXT REFERENCES signals(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_signals_person_id ON signals(person_id);
CREATE INDEX idx_signals_meeting_id ON signals(meeting_id);
CREATE INDEX idx_signals_kind ON signals(kind);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  category TEXT,                    -- 'trajectory' | 'topic' | 'skill' | 'free'
  created_at TEXT NOT NULL
);

CREATE TABLE person_tags (
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  source_meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (person_id, tag_id)
);

CREATE INDEX idx_person_tags_tag_id ON person_tags(tag_id);

CREATE TABLE tag_proposals (
  id TEXT PRIMARY KEY,
  proposed_name TEXT NOT NULL,
  proposed_category TEXT,
  example_person_ids TEXT,          -- JSON array
  status TEXT NOT NULL DEFAULT 'pending',
  merged_into_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_tag_proposals_status ON tag_proposals(status);

CREATE TABLE confirmation_queue (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,               -- 'person_resolution' | 'meeting_classification'
                                    -- | 'calendar_match' | 'extraction_review'
  payload TEXT NOT NULL,            -- JSON
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);

CREATE INDEX idx_confirmation_queue_status ON confirmation_queue(status, created_at);

CREATE TABLE followups (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  meeting_id TEXT REFERENCES meetings(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_followups_status_due ON followups(status, due_date);
CREATE INDEX idx_followups_person_id ON followups(person_id);

-- Tracks Granola ingestion progress so we don't re-process notes.
CREATE TABLE ingest_state (
  source TEXT PRIMARY KEY,
  last_processed_at TEXT,
  last_processed_ref TEXT,
  updated_at TEXT NOT NULL
);
