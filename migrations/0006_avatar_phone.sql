-- Optional fields used by TODOs M (auto-resolved avatar URL) and N
-- (phone number for mailto / Signal / iMessage shortcut links).

ALTER TABLE people ADD COLUMN avatar_url TEXT;
ALTER TABLE people ADD COLUMN avatar_source TEXT;  -- 'gravatar' | 'granola' | 'dicebear' | 'manual'
ALTER TABLE people ADD COLUMN phone TEXT;          -- E.164 (e.g. +14155551234)
