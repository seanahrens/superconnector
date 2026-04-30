# todos

Backlog of known work. Items are roughly priority-ordered. Each one should be
self-contained enough that an agent can pick it up without re-reading the
whole conversation history; cross-link to `GOTCHAS.md` and `CLAUDE.md` where
relevant.

---

## A. Smarter ingest-classification algorithm

**Why.** As of 2026-04-30, **0 of ~90 Granola notes have been processed**
into meetings/people. Every note hits the queue and most stay there. Two
amplifying problems:

- Granola Personal API only puts the owner in `attendees`, never real
  counterparts.
- Proton ICS feed is a rolling window of recent + upcoming events only —
  zero events from March exist in the feed (verified via
  `GET /api/run/check-ics` → `by_month`). So all backlog notes get no ICS
  match either.

Title alone is high-signal. Sample titles currently sitting in the queue:

> Aaron Hamlin Call · Ian at IPTS · Rihki · Hugo @ Catalyze Impact ·
> Gabriel Sherman · Justin Shenk - Civic Reliability

These obviously resolve to 1:1s with a named counterpart, but the current
classifier in `src/lib/classify.ts` is conservative (rules require
"1:1 with X" / "Coffee w/ X" / "X / Y" patterns) and the LLM call has no
transcript to lean on.

**Proposal — three-signal vote, no LLM required for the cheap cases.**

For each note:

1. **Solo / non-meeting filter** (already partly there via `isSoloNote`):
   if title is short generic ("Dr visit", "Busy", "Lunch", "Workout")
   AND no calendar_event AND transcript shows only one speaker label →
   skip silently.

2. **Title-pattern counterpart extraction.** A small set of regexes,
   then fall back to a single Haiku call. Order:
   - `^([A-Z][a-z]+(?:\s[A-Z][a-z]+)?)\s*(Call|Chat|Meeting|/.+|–.+|-.+|<>.+)?$`
     → counterpart = group 1 (e.g. "Aaron Hamlin Call", "Gabriel Sherman").
   - `^([^@]+?)\s@\s.+$` → counterpart = group 1 (e.g. "Hugo @ Catalyze Impact").
   - `^([^/]+?)\s*[/<>]+\s*([^/]+)$` → pick the side that isn't the user.
   - `^Coffee w(?:ith)?\s+(.+)$`, `^1:1 with (.+)$`, etc.
   - Fallback: Haiku with the title only — extracts `{kind, counterpart_name}`.

3. **Transcript speaker-count signal.** Count distinct
   `transcript[i].speaker.diarization_label` values across turns. Two
   distinct speakers → strong 1:1 signal. Three or more → group signal.
   Zero/one → no signal.

4. **ICS attendees** when present (existing path, retained).

**Decision matrix.** Confidence-vote: each signal that fires votes for a
classification. Auto-process when:
- 2+ signals vote 1:1 AND signals 2 and 3 don't disagree AND a counterpart
  name is extracted with confidence ≥ 0.7.
- 2+ signals vote group → skip with `classification = 'group'` (no people
  graph entry; record in an `ingest_log` table — see TODO 9).

Otherwise → queue (current behavior). This should auto-process the
clear-cut majority while keeping the queue for genuine ambiguity.

**Migration safety.** Don't reprocess existing pending queue items
automatically; the user is reviewing them by hand. New notes from the
next ingest tick onward use the new algorithm. Add an admin endpoint
`POST /api/admin/reclassify-queue` to opt-in re-run on the existing pending
items if desired.

**Touch points.**
- `src/lib/classify.ts` — extend with `classifyByTitle`,
  `classifyBySpeakers`, and a vote function.
- `src/cron/ingest.ts` — call the vote before the LLM fallback; if the
  vote yields a confident 1:1, run `materializeFromGranolaNote` directly
  with the extracted counterpart.
- `src/lib/queue_resolve.ts` — already has the materialization helper; reuse.

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

## 5. Move web UI to `mapendar.com` custom domain

The site is currently served from
`https://superconnector-pages.<acct>.workers.dev`. Goal: serve it from
`mapendar.com` (or a subdomain like `app.mapendar.com`) with TLS, behind
Cloudflare Access for single-sign-on.

**Steps (manual, in Cloudflare dashboard).**

1. Bring `mapendar.com` onto Cloudflare (add site, change registrar
   nameservers if needed).
2. Workers & Pages → `superconnector-pages` → Custom Domains → add
   `mapendar.com` (or `app.mapendar.com`). Cloudflare provisions the cert
   automatically.
3. Cloudflare Access (Zero Trust → Access → Applications) → add a Self-
   Hosted application for `mapendar.com`. Policy: allow only the user's
   email (single-user). This replaces the basic-auth gate added today —
   once Access is in front, you can either drop the `hooks.server.ts` gate
   or leave it as defense in depth (recommended).
4. Same treatment for the Worker URL `superconnector.<acct>.workers.dev`
   (or alias it under `api.mapendar.com`) so direct API access also goes
   through Access. The bearer-token proxy continues to work because Access
   passes through authenticated requests.
5. Update README / setup.sh prompts to reference `mapendar.com` once live.
6. Update the MCP client config in `~/Library/Application Support/Claude/
   claude_desktop_config.json` to point at the new MCP URL (Access
   service-token auth or a long-lived bearer is fine for headless MCP).

**Why now.** The previous public-token leak (resolved 2026-04-29) shows
that "single-user bearer in client JS" is structurally fragile. Edge auth
via Access removes that whole class of mistakes — even if a future
refactor accidentally exposes a token, Access still won't let the request
through.

---

## 5b. Followup security cleanup

In the same security pass that produced 2026-04-29's auth fixes, watch for:

- Pages worker should not log request bodies (currently doesn't, keep it that
  way).
- D1 binds use positional placeholders everywhere — keep this enforced; do
  not let an LLM-driven flow construct SQL by string concatenation. The
  `query_db_readonly` tool already refuses write keywords.
- The MCP `query_db_readonly` tool can read everything in D1 by design.
  That's intentional for the chat-as-CLI flow but means MCP_SECRET must
  never be checked in.
- `.secrets/` is gitignored; verify on every commit that no secret strings
  are staged (`git diff --cached -- ':!.secrets/' | grep -i secret` is a
  cheap manual check before pushing).

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

## B. "Add person" via freeform chat dictation

**Why.** Right now creating a new person requires resolving a queue item
(or directly hitting the API). Every new contact should be an "open chat,
type what you know, hit send" flow, since the per-person chat already
calls `dictate` to extract structured updates.

**Goal.**

- Add a "+" button to the people list (top of `/people`).
- Tapping it opens an empty per-person chat — but the person doesn't
  exist yet. The chat thread is scoped to a *placeholder* person that
  becomes real as soon as the first dictation extracts enough info
  (name, or name+email).
- The per-person chat thread (the one already wired in `PersonProfile`)
  *is* the input here — single source of truth for both "tell me about
  this person" and "create this person from scratch". When the chat
  resolves a name, redirect to `/people/<id>`.

**Touch points.**
- `pages/src/routes/people/+page.svelte` — add a "+" button (use
  `Icon.svelte` "plus") next to the search field.
- `pages/src/routes/people/new/+page.svelte` — new route hosting the
  chat in placeholder mode. Probably reuses `ChatPane` with a special
  scope `new-person` that the worker treats as "call dictate on the
  next message; create + resolve to the new person; then the thread
  moves with them".
- `src/api/chat.ts` — add scope handling for `new-person`. After the
  first dictate resolves a person, update the thread row's `person_id`
  and `scope='person'`, then surface the new id to the client so the
  page can redirect.

---

## C. People list — sort dropdown, icons, and overflow control

Three small fixes on `pages/src/routes/people/+page.svelte`:

1. **Drop the "(recency × frequency × custom)" parenthetical** in the
   "magical" option label. Just `Magical`. Either trust the name or
   move the formula to a tooltip on a `?` icon next to the dropdown.

2. **Icons next to each sort option.** Use `Icon.svelte`:
   - Magical → `sparkles` (add to icon set)
   - Most recent → `clock`
   - Most frequent → `bar-chart-2`
   - My custom order → `move-vertical` (or `grip-vertical`)
   Native `<select>` doesn't render icons in options on most browsers, so
   the cleanest path is a small custom dropdown component (button shows
   icon + label; menu lists options with icons). Keep the keyboard
   behavior of a `<select>` (arrow keys, enter, escape).

3. **Tags + roles overflow.** When `allTags` is large, the chip list
   currently runs unbounded down the sidebar and pushes the people list
   off-screen. Cap the visible chips (e.g. 12) with a "show all" toggle,
   OR put the whole filter region in a collapsible `<details>` so the
   default state is just the search bar + sort. Same for role chips
   when more roles get introduced. Sidebar should always show the
   people list above the fold.

---

## D. Search field icon

`pages/src/routes/people/+page.svelte` has a `<input type="search">` with no
visual affordance. Add the `search` icon (already in `Icon.svelte`) inside
the input — `position: relative` wrapper, `position: absolute` icon at left,
`padding-left: 32px` on the input.

---

## E. Master-chat example prompts: auto-send, don't fill-and-wait

Currently clicking an example in the master-chat empty state seeds the
textarea and waits for the user to press send. The user feedback was: just
*send* it. ChatPane already has `send()`; the example click should call
it after setting input.

**Implementation.** Pass an `autoSend` flag alongside `initialInput`:

- `MasterChatDrawer.startWith(text)` sets `seed = text` AND
  `seedAutoSend = true`.
- `ChatPane` props: `initialInput?: string`, `autoSend?: boolean`. When
  `lastSeed` changes and `autoSend` is true, set input then call `send()`.

Keep the current "set the input and wait" path available too in case
some future surface wants the prefill-only behavior.

---

## F. Tags page: clarify what "proposals" are and what the left pane is for

Right now `/tags` shows existing tags on the left (un-clickable) and tag
proposals on the right with no explanation of either. UX issues:

- **Existing-tags column has no purpose.** Tags aren't clickable, don't
  filter anything, and the page doesn't let you create/rename/delete a
  tag. Either make them clickable (e.g. clicking a tag jumps to
  `/people?tags=<name>`) or remove the column.
- **"Proposals" needs a one-liner.** During ingest, the extraction LLM
  suggests new tags it thinks should exist (e.g. "trajectory/raising_seed"
  emerging from a meeting). Until you accept one, it doesn't enter the
  canonical tag set. Add a short header explaining this.
- **Make the left column actionable** by linking each tag name to the
  filtered people view, and add a "merge" / "rename" / "delete" affordance
  per row. Then the page becomes "your tag taxonomy" rather than two
  half-loose lists.

---

## G. Ingest disposition log

To answer "do you have all the notes" the system needs an `ingest_log`
table that records every note id seen and what we did with it
(`processed`, `skipped_solo`, `skipped_group`, `queued`, `errored`,
`reprocessed`). Adds a fourth tab "Skipped" to `/notes` and lets the user
sanity-check that nothing is being silently dropped. Light schema; small
migration.

---

## Done (recent)

For context — these were resolved in the most recent agent session:

- **Security: Pages worker locked behind HTTP Basic Auth** (`pages/src/hooks.server.ts`)
  and Worker API token moved to a server-side proxy
  (`pages/src/routes/api/[...path]/+server.ts`). Browser no longer sees the
  bearer. CORS allow-all dropped. `requireAuth` and MCP auth now fail
  closed when their secret is missing in non-dev environments. **Action
  required by the user** after pulling this change:
  - `cd pages && npx wrangler secret put WEB_AUTH_SECRET` (paste the same
    value the Worker uses, from `.secrets/WEB_AUTH_SECRET`).
  - `cd pages && npx wrangler secret put WORKER_API_BASE` (paste the
    Worker's deployment URL, e.g.
    `https://superconnector.<acct>.workers.dev`).
  - Rotate `WEB_AUTH_SECRET` after the secrets are in place since the old
    value was publicly exposed in the client bundle.
- Daily email: `From: SuperConnector <addr>` and an LLM-generated content-led
  subject (Haiku 4.5, with deterministic fallback).
- Web chat: Enter sends, Shift-Enter inserts newline (IME-aware).
- Master chat empty state: example queries + click-to-prefill.
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
