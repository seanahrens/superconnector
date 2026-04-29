-- Chat threads + messages for the master and per-person web-UI chats.

CREATE TABLE chat_threads (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL,              -- 'global' | 'person'
  person_id TEXT REFERENCES people(id) ON DELETE CASCADE,
  title TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (
    (scope = 'global' AND person_id IS NULL)
    OR (scope = 'person' AND person_id IS NOT NULL)
  )
);

CREATE INDEX idx_chat_threads_person_id ON chat_threads(person_id);
CREATE INDEX idx_chat_threads_updated_at ON chat_threads(updated_at DESC);

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL,               -- 'user' | 'assistant' | 'tool'
  content TEXT,
  tool_calls TEXT,                  -- JSON: Anthropic tool_use / tool_result records
  created_at TEXT NOT NULL
);

CREATE INDEX idx_chat_messages_thread_id ON chat_messages(thread_id, created_at);
