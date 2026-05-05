-- Wants refactor: collapse `needs`/`offers` into a single `wants` field on
-- people, collapse signal kinds 'need'|'offer' into 'want', replace per-signal
-- `confidence` (poorly calibrated LLM float) with categorical `evidence`
-- ('explicit'|'inferred'|'weak') plus an optional `source_span` quote, and
-- add `last_validated_at` so echoes refresh the timestamp instead of
-- inserting duplicate rows.

PRAGMA foreign_keys = ON;

-- 1) Add new columns on signals.
ALTER TABLE signals ADD COLUMN evidence TEXT;
ALTER TABLE signals ADD COLUMN source_span TEXT;
ALTER TABLE signals ADD COLUMN last_validated_at TEXT;

-- 2) Backfill signals: collapse 'need'/'offer' into 'want', map confidence
--    floats onto evidence buckets, seed last_validated_at from created_at.
UPDATE signals SET kind = 'want' WHERE kind IN ('need', 'offer');
UPDATE signals SET evidence = CASE
  WHEN confidence IS NULL THEN 'inferred'
  WHEN confidence >= 0.8 THEN 'explicit'
  WHEN confidence >= 0.5 THEN 'inferred'
  ELSE 'weak'
END;
UPDATE signals SET last_validated_at = created_at WHERE last_validated_at IS NULL;

ALTER TABLE signals DROP COLUMN confidence;

-- 3) Drop people_fts before mutating people (it references needs/offers
--    columns via external content). We rebuild it at the bottom against the
--    new schema.
DROP TRIGGER IF EXISTS people_ai;
DROP TRIGGER IF EXISTS people_ad;
DROP TRIGGER IF EXISTS people_au;
DROP TABLE IF EXISTS people_fts;

-- 4) Rename `needs` → `wants`, then fold any non-empty `offers` content into
--    it. We keep the offers content because dropping it outright would lose
--    information; we don't try to keep a need/offer distinction.
ALTER TABLE people RENAME COLUMN needs TO wants;

UPDATE people SET wants = TRIM(
  COALESCE(wants, '') ||
  CASE
    WHEN offers IS NOT NULL AND length(trim(offers)) > 0
      THEN CASE
        WHEN wants IS NOT NULL AND length(trim(wants)) > 0
          THEN char(10) || char(10) || offers
        ELSE offers
      END
    ELSE ''
  END
);
UPDATE people SET wants = NULL WHERE wants IS NOT NULL AND length(trim(wants)) = 0;

ALTER TABLE people DROP COLUMN offers;

-- 5) Recreate people_fts against the new column set.
CREATE VIRTUAL TABLE people_fts USING fts5(
  display_name,
  context,
  wants,
  content='people',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

INSERT INTO people_fts (rowid, display_name, context, wants)
  SELECT rowid, display_name, context, wants FROM people;

CREATE TRIGGER people_ai AFTER INSERT ON people BEGIN
  INSERT INTO people_fts(rowid, display_name, context, wants)
  VALUES (new.rowid, new.display_name, new.context, new.wants);
END;

CREATE TRIGGER people_ad AFTER DELETE ON people BEGIN
  INSERT INTO people_fts(people_fts, rowid, display_name, context, wants)
  VALUES('delete', old.rowid, old.display_name, old.context, old.wants);
END;

CREATE TRIGGER people_au AFTER UPDATE ON people BEGIN
  INSERT INTO people_fts(people_fts, rowid, display_name, context, wants)
  VALUES('delete', old.rowid, old.display_name, old.context, old.wants);
  INSERT INTO people_fts(rowid, display_name, context, wants)
  VALUES (new.rowid, new.display_name, new.context, new.wants);
END;
