-- Track whether a Granola note's content has changed since we last ingested
-- it, so an edit (renamed title, expanded summary, fresh transcript) triggers
-- reprocessing instead of being short-circuited by source_ref alone.

ALTER TABLE meetings ADD COLUMN source_content_hash TEXT;
ALTER TABLE meetings ADD COLUMN source_updated_at TEXT;

CREATE INDEX idx_meetings_source_updated_at ON meetings(source_updated_at);
