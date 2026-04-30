-- Distinct fields for where someone lives vs where they work, and the org
-- they work at (separate from `roles`, which is a coarse classification).
-- Keeps `geo` around as a generic fallback so older rows don't blank out.

ALTER TABLE people ADD COLUMN home_location TEXT;   -- e.g. "Berlin, DE"
ALTER TABLE people ADD COLUMN work_location TEXT;   -- e.g. "Boulder, CO" or "Remote"
ALTER TABLE people ADD COLUMN work_org TEXT;        -- e.g. "FAR Labs"
