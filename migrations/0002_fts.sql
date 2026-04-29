-- Full-text search indexes over freetext fields.
-- External-content tables stay in sync via triggers below.

CREATE VIRTUAL TABLE meetings_fts USING fts5(
  transcript,
  summary,
  content='meetings',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER meetings_ai AFTER INSERT ON meetings BEGIN
  INSERT INTO meetings_fts(rowid, transcript, summary)
  VALUES (new.rowid, new.transcript, new.summary);
END;

CREATE TRIGGER meetings_ad AFTER DELETE ON meetings BEGIN
  INSERT INTO meetings_fts(meetings_fts, rowid, transcript, summary)
  VALUES('delete', old.rowid, old.transcript, old.summary);
END;

CREATE TRIGGER meetings_au AFTER UPDATE ON meetings BEGIN
  INSERT INTO meetings_fts(meetings_fts, rowid, transcript, summary)
  VALUES('delete', old.rowid, old.transcript, old.summary);
  INSERT INTO meetings_fts(rowid, transcript, summary)
  VALUES (new.rowid, new.transcript, new.summary);
END;

CREATE VIRTUAL TABLE people_fts USING fts5(
  display_name,
  context,
  needs,
  offers,
  content='people',
  content_rowid='rowid',
  tokenize='porter unicode61'
);

CREATE TRIGGER people_ai AFTER INSERT ON people BEGIN
  INSERT INTO people_fts(rowid, display_name, context, needs, offers)
  VALUES (new.rowid, new.display_name, new.context, new.needs, new.offers);
END;

CREATE TRIGGER people_ad AFTER DELETE ON people BEGIN
  INSERT INTO people_fts(people_fts, rowid, display_name, context, needs, offers)
  VALUES('delete', old.rowid, old.display_name, old.context, old.needs, old.offers);
END;

CREATE TRIGGER people_au AFTER UPDATE ON people BEGIN
  INSERT INTO people_fts(people_fts, rowid, display_name, context, needs, offers)
  VALUES('delete', old.rowid, old.display_name, old.context, old.needs, old.offers);
  INSERT INTO people_fts(rowid, display_name, context, needs, offers)
  VALUES (new.rowid, new.display_name, new.context, new.needs, new.offers);
END;
