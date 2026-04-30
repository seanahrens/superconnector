# todos

Backlog of known work. Items are roughly priority-ordered. Each one should be
self-contained enough that an agent can pick it up without re-reading the
whole conversation history; cross-link to `GOTCHAS.md` and `CLAUDE.md` where
relevant.

---

## 1. Re-pull Granola notes and reprocess on title/content edits

**Why.** The user is going back through Granola to improve note titles so
attendees can be identified. Right now ingest is one-shot per `source_ref`:
`isAlreadyIngested()` short-circuits as soon as a meeting row exists for a
given Granola note id. So re-titled notes don't re-process and their queue
items / phantom rows never get fixed automatically.

**Goal.** Detect when a previously-seen Granola note has changed (title,
summary, or transcript) and re-run the classification + extraction path,
reusing the same `meeting_id` if possible.

**Design sketch.**

1. New column on `meetings`: `source_content_hash TEXT`. Compute it at ingest
   time as e.g. `sha256(title + '\n' + summary + '\n' + transcript_str)`. Add
   a migration `migrations/0004_source_hash.sql`.
2. `isAlreadyIngested()` becomes `getExistingMeeting(sourceRef)` returning
   `{id, source_content_hash} | null`.
3. In `runIngest`, also use Granola's `updated_at` as a cheap pre-filter:
   if `note.updated_at` ≤ existing meeting's `updated_at` (store this on
   `meetings` too), skip. Otherwise compute the hash; if it differs, reprocess.
4. Reprocessing path:
   - Update the meeting row in place (title, summary, transcript, hash).
   - If classification or counterpart resolution would now change (e.g. the
     user added "1:1 with Alex Smith" to the title), enqueue a
     `meeting_reclassification` confirmation_queue item rather than silently
     reassigning to a different person — too destructive to do unattended.
   - Re-run extraction. New signals get appended; old ones from this meeting
     stay in place but should be marked `superseded_by` on the new ones the
     LLM produces (the schema already has this column, currently unused).
5. Also: a manual refresh button. `POST /api/admin/repull-granola?since=<ISO>`
   that resets the high-water mark to `since` (or to the start of time) and
   forces a single ingest run. Cheaper than touching the DB by hand.
6. UI hooks (later): show an "edited in Granola" badge on meeting cards in
   the person profile when the hash changed; surface
   `meeting_reclassification` items in the queue.

**Touch points.**
- `migrations/` — new migration adding `source_content_hash`, `source_updated_at`.
- `src/cron/ingest.ts` — replace `isAlreadyIngested` logic, add reprocess path.
- `src/lib/granola.ts` — already exposes `updated_at`. Add a `noteContentHash()`
  helper next to `transcriptToString()`.
- `src/index.ts` — new admin endpoint.
- `pages/...` — defer.

**Gotchas.**
- The Granola Personal API rate-limits at 25 req / 5s. A full re-pull of N
  notes is N+1 calls (one list + one detail each). For now a few hundred
  notes fits comfortably; if it grows, batch with delays.
- Re-running extraction costs Anthropic credits. Cache by hash so we don't
  re-extract identical content twice.
- Meetings reassigned to a different person should NOT delete the old
  person's signals — those came from real meeting content. Only reroute new
  signals.

---

## 2. Web-UI chat: Enter sends, Shift-Enter inserts newline

**Why.** Currently the per-person and master-chat composers don't follow
keyboard conventions. Enter should send; Shift-Enter should insert a newline.

**Where.**
- `pages/src/lib/components/ChatPane.svelte` — per-person chat (and is
  reused inside the master-chat drawer).
- `pages/src/lib/components/MasterChatDrawer.svelte` — also has its own input
  if it doesn't reuse ChatPane; check first.

**Implementation.**
- Bind `onkeydown` on the textarea: if `event.key === 'Enter' && !event.shiftKey
  && !event.isComposing`, call `preventDefault()` and submit. Otherwise let it
  through (Shift-Enter inserts newline naturally).
- `event.isComposing` matters for IME users — don't intercept while a CJK
  candidate window is open.
- The composer is currently a `<textarea>`; keep it that way so Shift-Enter
  produces a real `\n`.
- If the form has any default Enter handling (e.g. an `<input type="submit">`
  inside a form), make sure it doesn't double-submit.

---

## 3. Reactive person profile + persistent chat histories

**Two related bugs in the per-person chat:**

1. **Profile isn't reactive to chat-driven mutations.** When a chat call to
   `update_person`, `apply_tag`, etc. mutates the underlying row, the right
   pane (`PersonProfile.svelte`) keeps showing the pre-edit state until the
   user manually refreshes. The chat already streams `tool_use` and
   `tool_result` events — wire those to a refetch of the person view when a
   write tool succeeds.

2. **Per-person chat history vanishes between visits.** The schema (`chat_threads`,
   `chat_messages` from `migrations/0003_chat.sql`) supports persistent
   per-person and global threads, but the UI doesn't load existing messages
   on profile mount — it always starts a fresh session. Same for the master
   ⌘K drawer.

**Goal.**

- Persistent per-person chat threads, scoped by `person_id`. Re-opening a
  profile loads the most recent thread (or lets the user pick from a list).
- Persistent master/global chat threads — sidebar/drawer should show recent
  threads and let the user resume any of them.
- After any tool call that writes (not read-only), trigger the right pane to
  refetch the person view so changes show without a manual refresh.

**Touch points.**

- `pages/src/lib/components/ChatPane.svelte` — on mount, load the most recent
  thread for the current scope. After each `tool_result` event whose tool is
  in a "write" set, emit an event the parent can listen to.
- `pages/src/lib/components/PersonProfile.svelte` — refetch view when
  ChatPane signals a write happened.
- `pages/src/lib/components/MasterChatDrawer.svelte` — show a thread list,
  allow resuming.
- `src/api/chat.ts` — add a `GET /api/chat/threads?scope=person&person_id=…`
  list endpoint and a `GET /api/chat/threads/:id/messages` history endpoint
  if they don't already exist (verify before duplicating).
- `src/tools/index.ts` — annotate each tool with `readOnly: boolean` so the
  client can know whether to refetch.

**Gotchas.**

- The streaming endpoint in `src/api/chat.ts` already persists user/assistant
  messages; verify thread creation isn't accidentally creating a new thread
  on every page load.
- Don't auto-load a thread the user explicitly closed/cleared. Provide a
  "new thread" button.

---

## 4. Daily-email sender name + LLM-generated subject

The daily email currently sends with `From: <env.EMAIL_FROM>` (just the bare
address) and a subject line built by `subject(now, meetingCount, weekly)` in
`src/cron/daily_email.ts` (around line 46) that reads e.g.
`[superconnector] 2026-04-30 — 3 meetings + weekly digest`.

**Goal:**

- **Sender name** should display as `SuperConnector` in the user's inbox, not
  the raw email address. `sendEmail()` in `src/lib/email.ts` already accepts
  an optional `fromName` and renders `From: SuperConnector <addr>` when
  passed. Just plumb a `fromName: 'SuperConnector'` through from
  `daily_email.ts`.
- **Subject** should drop the `[superconnector]` prefix and stop encoding
  the date or meeting count. Instead, generate a single short, content-led
  subject (≤ 70 chars, no emoji) that captures one or two key takeaways from
  the email body — e.g. *"Brief Sarah Chen on her funder thesis; intro for
  Alex's cofounder search"* or *"Quiet day — two stale founder followups due"*.
- Generate via Anthropic Haiku 4.5 with prompt caching. Pass it the rendered
  plaintext body (already built in `daily_email.ts` as `text`) plus a
  short instruction. Use `jsonCall` from `src/lib/anthropic.ts` with a tiny
  schema like `{"subject": string}` so we don't have to parse free text.
- Fall back to a deterministic subject (something like
  `Daily — N meetings`) if the LLM call fails, so a transient API issue
  doesn't block the send.

**Touch points.**

- `src/cron/daily_email.ts` — replace the `subject(...)` helper with an async
  `subjectFor(env, text, includeWeekly)` that calls Haiku, awaited before
  `sendEmail`. Also pass `fromName: 'SuperConnector'`.
- `src/lib/email.ts` — no changes; `fromName` already exists.

**Gotchas.**

- The subject generator runs once per day per send. Cost is negligible, but
  prompt-cache the system message anyway for cleanliness.
- Don't pass the HTML body — it's much longer and the markup just confuses
  the model. Pass the plaintext rendering.
- Cloudflare Email Workers may reject very long subjects; cap to ≤ 200 chars
  client-side to be safe.

---

## 5. Cloudflare Access in front of Worker + Pages

Single-user bearer token (`WEB_AUTH_SECRET`) is fine but the Pages app shows
its UI to anyone with the URL (data is still gated, but it's noise). Adding
Cloudflare Access (free, ≤50 users) puts a login wall at the edge. Manual
config in the dashboard, no code changes needed; document the steps in
README once enabled.

---

## 6. Commit `database_id` to `wrangler.toml`

The setup script patches the D1 `database_id` into `wrangler.toml` locally
and the user's Mac repeatedly conflicts with upstream pulls. Decide whether
to commit it (single-user repo; not actually a secret since the binding
requires Cloudflare auth) and stop the conflict loop, or keep it as
`REPLACE_WITH_D1_ID` and document the `git stash; git pull; git stash pop`
ritual. Leaning toward committing it.

---

## 7. Voicebox into cron-hub (deferred)

Once `voicebox` (separate repo) needs scheduled jobs and we'd otherwise blow
the cron limit, deploy `cron-hub/` and migrate both projects' triggers into
it. Steps in `cron-hub/README.md`. Currently dormant code; keep it building
so it's deployable when needed.

---

## 8. Followups: nudges and re-engagement

The schema has `followups` and `last_met_date`, the daily email already
includes due-today followups, but there's nothing yet for:
- "Stale active" — a tagged-active person you haven't met with in N days.
- Auto-followup drafting from `commitment` signals ("I'll send Sarah the deck"
  → followup row with `due_date = +3 days`).

Sit on this until there's enough data to know what cadence is actually
useful.

---

## 9. Empty-state polish

After cleanup the people list and queue can be empty. Both screens already
handle this, but the master-chat empty state could suggest example queries
("who's a good cofounder for…?", "show me funders interested in evals", etc.)
to bootstrap the user's first conversations.

---

## Done (recent)

For context — these were resolved in the most recent agent session:

- Fixed Granola base URL (`api.granola.so` → `public-api.granola.ai`).
- Fixed Granola transcript array → string folding.
- Used Granola's own `calendar_event.attendees` instead of relying on ICS only.
- Stopped creating phantom (unknown) people; route to queue instead.
- `isSoloNote()` skips personal brainstorming notes.
- MCP `tools/list` switched from `input_schema` to `inputSchema`.
- MCP `notifications/initialized` handled.
- Hono routes wrap `runIngest`/`runDailyEmail` in try/catch and return JSON
  error bodies instead of generic "Internal Server Error".
- Admin endpoints: `/api/admin/cleanup-phantoms`, `/clear-queue`,
  `/reset-ingest`.
- Diagnostic: `/api/run/check-granola`.
- Queue UI: shows note titles, formatted meeting_classification view with
  attendees / classifier reason / transcript preview / Granola link, and a
  "clear all" button.
- People list API filters out phantom rows by default.
