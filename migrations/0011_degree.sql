-- Per-profile "degree" — how many connection hops the person is from the user
-- (the single owner of this CRM):
--   0 = the user themselves
--   1 = direct connection (default)
--   2 = needs an intro / not directly known
--
-- Replaces email-based "is this me?" checks on profile-level operations.
-- Existing rows get the default 1; ensureMePerson / findMePerson normalize
-- the user's own row to 0 on the next call so we don't have to thread
-- EMAIL_TO into the migration itself.

ALTER TABLE people ADD COLUMN degree INTEGER NOT NULL DEFAULT 1;

CREATE INDEX idx_people_degree ON people(degree);
