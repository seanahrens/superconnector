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

## G1. Notes detail: tabbed Summary / Transcript, consistent across tabs

The detail pane on `/notes` should show the same Granola note content no
matter which tab a note came from (Needs review, Processed, Dismissed) —
right now Processed shows nothing meaningful and Dismissed shows the
classifier-time payload (which omits the full transcript).

**Goal.**

- New "Note" section on the detail pane with two sub-tabs:
  - **Summary** (default) — Granola's meeting summary
    (`note.summary`).
  - **Transcript** — the full diarized transcript
    (`meetings.transcript`, or fetched live via the Granola API for
    queue items where we only stashed a 1500-char preview).
- Both views in a scrollable container, fixed max-height (~50vh) so
  the detail pane stays browsable.
- The same component renders for all three tab states so the UX is
  uniform. Re-fetch full content from Granola if the queue payload
  doesn't have it.

**Touch points.**
- `pages/src/routes/notes/+page.svelte` — replace the inline summary +
  transcript-preview blocks with a `<NoteContent>` component that takes
  `{noteId, summary, transcript}` and lazily fills missing fields by
  hitting a new endpoint.
- `src/api/queue.ts` (or a new `src/api/notes.ts`) — `GET
  /api/notes/:source_ref` returning `{summary, transcript}` from
  Granola, used by the detail pane when only a preview is on hand.
- The Processed tab currently shows a static "Tap a row…" placeholder;
  selecting a processed row should open this same detail view rather
  than navigating straight to the person.

**Gotchas.**
- Dismissed queue items only have a 1.5K transcript preview in their
  payload. Re-fetch from Granola for those (note id is in the
  payload).
- Transcript can be long. Render with `white-space: pre-wrap` and a
  fixed-height scroll region.

---

## G2. Notes left-pane date = meeting date, not classification date

The left list currently shows `created_at` of the queue row (which is
when ingest classified it — almost always today's date for the user's
backlog). Show the date of the actual meeting instead so the list reads
as a chronology of meetings.

- For pending/dismissed queue items: use
  `payload.note.created_at` (Granola note timestamp ≈ meeting time)
  rather than the queue row's `created_at`.
- For processed items: use `meetings.recorded_at` (already what
  `/api/queue/processed` returns).

Sort **every list** (Needs review, Processed, Dismissed) by meeting
date descending — newest conversation at the top — using the
`meetingDate(item)` helper above. Falls back to queue `created_at`
only if the note timestamp is missing. The processed list already
sorts by `meetings.recorded_at DESC` server-side; the queue list
needs either a client-side sort after fetch or a `?sort=meeting_date`
parameter on the list endpoint.

**Touch points.**
- `pages/src/routes/notes/+page.svelte` — adjust `listLabel` /
  `fmtDate` callsites to read `payload.note.created_at` (with a
  helper `meetingDate(item)` that picks the right field per kind).
- Optionally also reorder the lists by `meetingDate` descending; the
  API currently orders by queue `created_at`. Either sort
  client-side after the fetch, or add `?sort=meeting_date` to the
  list endpoint.

---

## H. People list — alphabetical sort

Add an `Alphabetical` option to the sort dropdown in
`pages/src/routes/people/+page.svelte`. Server side
(`src/api/people.ts`) needs a corresponding `sort=alpha` branch that
orders by `LOWER(display_name) ASC NULLS LAST`. Pair with TODO C (sort
icons): use `arrow-down-a-z` (or `align-left`) for the alpha option.

---

## I. People profile — "Merge with" action

**Why.** Granola+queue resolution will create duplicates: the same
person under their first name only, under a slightly different email
("alex@x.com" and "alex.smith@x.com"), or a typo. Need a quick path to
fold one record into another without going to SQL.

**Goal.**

A "Merge with…" button on `PersonProfile.svelte`. Clicking opens a
modal that:

1. **Lists up to 10 ranked merge candidates** for this person, plus a
   search box, plus an alphabetical-by-name fallback list of all people
   if the user wants to pick someone the heuristic missed.
2. **Side-by-side preview** when a candidate is selected: left column =
   the person we're acting on (kept), right column = the candidate
   (folded into the left). Shows display_name, primary_email, aliases,
   roles, trajectory_tags, last_met_date, meeting_count, tags.
3. **Confirm modal** before performing the merge.
4. **Backend** does the merge via an LLM-assisted reconciliation pass:
   pick the longer/more-complete value for each field, union arrays
   (roles, aliases, tags), reparent meetings/signals/followups/
   chat_threads to the kept id, then delete the donor row.

**Candidate ranking heuristics (no LLM, regex-only).** Score each
non-self person 0..100 and take top 10:

- **Local-part match:** if both have email and the part before `@`
  matches case-insensitively (e.g. `alex@a.com` ↔ `alex@b.com`) → +60.
- **Email-prefix match (5+ chars):** local-parts share a prefix of 5+
  chars (`alex` ↔ `alex.smith`) → +30, longer matches score higher.
- **Domain match** (`@b.com` ↔ `@b.com`) → +5.
- **First-name exact match** (case-insensitive) → +40.
- **Last-name exact match** when both have a last name → +25.
- **Single-name vs full-name:** if one display_name is one token and
  matches the first or last token of the other → +30 (the canonical
  "Alex" + "Alex Smith" case the user described).
- **Levenshtein distance ≤ 2** on the lowercased full name → +20.
- **Email matches an entry in `aliases`** → +50.
- Drop candidates with score < 25.

Result: dedupe by id, sort by score desc, return up to 10. The full
people list (alphabetical) is shown below the candidates so the user
can fall back to picking by hand.

**Backend merge endpoint.** New `POST /api/people/:keepId/merge`,
body `{ donor_id }`. Steps inside a single D1 batch:

```
UPDATE meetings        SET person_id = keep WHERE person_id = donor;
UPDATE signals         SET person_id = keep WHERE person_id = donor;
UPDATE followups       SET person_id = keep WHERE person_id = donor;
UPDATE person_tags     SET person_id = keep WHERE person_id = donor
  ON CONFLICT(person_id, tag_id) DO NOTHING;
UPDATE chat_threads    SET person_id = keep WHERE person_id = donor;
```

Then merge the rows themselves — for this *do* call Haiku with both
person rows JSON'd up and the rule "produce the most complete
resulting record; never overwrite manual_override fields; union all
arrays". Cheap, one-shot. Apply the result with `update_person`.

Re-embed the kept person's vector since context changed.

**Touch points.**
- `src/lib/merge_people.ts` — new helper: rank candidates + perform
  merge.
- `src/api/people.ts` — `GET /api/people/:id/merge-candidates`,
  `POST /api/people/:id/merge`.
- `pages/src/lib/components/PersonProfile.svelte` — "Merge with…"
  button.
- `pages/src/lib/components/MergeModal.svelte` — new component:
  ranked candidates, search, alpha list, side-by-side preview,
  confirm.

**Gotchas.**
- Don't allow merging a person into themselves.
- `chat_threads` reparent might conflict if both ids already have
  threads — that's fine, we keep both threads under the new id.
- `meeting_count` on the kept row needs recomputing after merge:
  `UPDATE people SET meeting_count = (SELECT COUNT(*) FROM meetings
  WHERE person_id = ?) WHERE id = ?`.
- The merge is destructive (donor row goes away). Confirm modal must
  be a real modal, not a `confirm()` dialog.

---

## J. Transcript rendering: speaker labels + two-column layout

**Why.** Current rendering looks like:

```
[microphone] Is that right?
[speaker] Based in Berlin?
[microphone] Okay.
[speaker] I just traveled for the weekend.
```

`[microphone]` is the user (the device's mic input — that's Sean), and
`[speaker]` is the other person on the call (their voice came through
the speaker output). The bracketed labels are noisy and the conversation
doesn't read naturally.

**Goal.** Re-render transcripts as a two-column layout:

```
You    Is that right?
Them   Based in Berlin?
You    Okay.
Them   I just traveled for the weekend.
```

- Substitute `microphone` → `You`, `speaker` → `Them`, and any other
  diarization label → the label itself (sometimes Granola assigns
  "Speaker A" / "Speaker B" or a real name).
- Two columns: speaker on the left, utterance on the right.
- Speaker label visually distinct from the spoken text — smaller, muted
  color, monospace or uppercase tracking. The utterance is regular body
  text, left-aligned to the right of the speaker column.
- Repeat speakers don't suppress the label (keeps each turn scannable).
- Long utterances wrap; the speaker column stays a fixed width
  (~56px) so the right column aligns.

**Implementation.** A new `<TranscriptView text={transcript} />`
component used wherever we currently render `transcript` or
`transcript_preview`. Parse the `[label] text` pattern line by line
(the existing `transcriptToString` in `src/lib/granola.ts` produces
exactly that format). Map labels at the boundary:

```ts
const SPEAKER_LABEL: Record<string, string> = {
  microphone: 'You',
  speaker: 'Them',
};
function prettyLabel(raw: string): string {
  const lo = raw.toLowerCase();
  return SPEAKER_LABEL[lo] ?? raw;
}
```

Render with CSS grid (`grid-template-columns: 56px 1fr; gap: 8px 12px`).
Each turn becomes two grid cells. The component handles lines without a
`[label]` (rare — diarization didn't tag them) by rendering them in the
right column with no left label.

**Touch points.**
- `pages/src/lib/components/TranscriptView.svelte` — new component.
- `pages/src/routes/notes/+page.svelte` — replace the `<pre
  class="transcript">` block. Pairs naturally with TODO G1 (tabbed
  Summary / Transcript view).
- `src/lib/granola.ts` — leave `transcriptToString` as-is; rendering
  is purely a UI concern. (If we ever switch the on-disk format,
  also support a structured `Array<{label, text}>` shape directly.)

**Optional polish.** Slightly indent / tint the "You" rows differently
from "Them" rows so it scans like a chat log. Keep it subtle — the
speaker column already does most of the disambiguation.

---

## K. Notes detail: action panel above the transcript, shorter transcript

In `pages/src/routes/notes/+page.svelte` (and the upcoming
`<NoteContent>` component from TODO G1), the "Resolve as 1:1" /
"create + ingest" action block currently sits at the bottom of the
detail pane, below the transcript preview. On a backlog of long
transcripts this means scrolling past hundreds of lines just to act.

**Goal.**

- Move the resolve / dismiss / counterpart-input section to the top of
  the detail pane, right under the header and metadata. Action first,
  context second.
- Halve the transcript scroll-region height: change `.transcript`'s
  `max-height: 50vh` → `25vh` (and `pre`'s `max-height: 60vh` → `30vh`).
  Keeps the transcript scrubbable but lets the resolve actions stay
  visible without scrolling on typical screens.
- Order on the page becomes: header → resolve actions → Granola event
  metadata → summary → transcript.

**Touch points.**
- `pages/src/routes/notes/+page.svelte` — reorder the JSX blocks
  inside each `selected.kind === ...` branch and adjust the
  `.transcript` / `pre` max-heights. Mobile already collapses the
  layout; verify the action block stays comfortably above the fold
  in both viewports.

---

## L. Eliminate loading-induced layout shifts

**Why.** Multiple pages currently render an empty/null state, then jump
when data lands. CLS hurts both feel and "did I just misclick?"
moments — most visible on:

- `/people/[id]` — `view = null` shows a small "Loading…" line, then
  the full profile (header, sections, chatbox) snaps in.
- `/people` and `/notes` — sidebar shows "loading…" then a list of N
  rows, jumping the layout.
- `/notes` detail pane — switching between items resizes content
  panels (different transcript lengths, summary present/absent).
- Master chat drawer — recent-threads list loads async; the empty
  state sits there briefly before the list materializes.
- Tabs counts (`Needs review 16`) appear after counts load — the
  zero/N flip is visible if you watch for it.

**Goal.** Reserve space ahead of time. The page should look
structurally the same on first paint as on data-loaded paint, even
when fields are blank.

**Concrete fixes per surface.**

1. **`PersonProfile`** — render the section skeleton (Tags, Context,
   Needs/Offers, Recent meetings, Signals, Followups, Chat) even when
   `view` is null. Each section becomes a fixed-height placeholder
   with a subtle pulse. Use a small `<Skeleton h="…" />` component or
   inline a `min-height` per section.

2. **`pages/src/routes/people/[id]/+page.svelte`** — drop the
   `view = null; view = await api.get(...)` flicker. Keep the
   previous `view` in place while the new one loads (or render the
   skeleton on first load only).

3. **People / Notes lists** — render N skeleton rows
   (`min-height: 56px` ×, say, 8) while loading. Avoids the "loading…"
   text → list jump.

4. **Notes detail content panel** — wrap the right pane in a fixed
   `min-height` container so picking a short item doesn't shrink the
   pane below the fold and jump the scroll position.

5. **Tabs counts** — initialize `counts = {pending: -, processed: -,
   dismissed: -}` and render the chip with a non-breaking space or a
   thin "—" placeholder until real numbers arrive. Pre-loaded width
   keeps the tab buttons from re-flowing.

6. **Master chat drawer** — render a skeleton list of 3 rows in the
   "Recent threads" slot while `loading` is true, instead of switching
   from "Loading recent threads…" text to a list.

7. **Topbar nav active marker** — the route doesn't change but the
   underline pseudo-element appears on hydration; verify with the
   `prefers-reduced-motion` check that there's no animated transition
   that makes the underline appear to pop in late.

**Quick wins to ship first.**

- Add `min-height` reservations on the `.content` containers in
  `/people/[id]` (profile pane), `/notes` (detail pane), and the
  master-chat drawer body.
- Replace inline "loading…" text strings with stable-height skeleton
  blocks.

A small `<Skeleton>` component (`pages/src/lib/components/Skeleton.svelte`)
with a CSS pulse animation handles the rest.

**How to verify.** Open Chrome DevTools → Rendering → "Layout Shift
Regions" overlay, then navigate around. Anything still highlighted
goes on the punch list.

---

## M. Person avatars — automated, no upload required

**Why.** A personless people list is hard to scan. Photos give faces.

**Cascade (cheap → less cheap, all server-side):**

1. **Gravatar.** Hash `lower(trim(primary_email))` with MD5 and request
   `https://www.gravatar.com/avatar/<hash>?s=128&d=404`. The `d=404`
   param means Gravatar returns 404 (rather than a default silhouette)
   when there's no account, so we know to fall through. Free, fast,
   coverage is patchy but ~30% in tech circles.
2. **Granola owner photo.** When ingest sees a Granola
   `calendar_event.attendees[i]` with a photo URL (Granola sometimes
   surfaces Google avatars for organizer/attendees), stash it on the
   person row.
3. **DiceBear initials avatar** as the deterministic fallback —
   `https://api.dicebear.com/9.x/initials/svg?seed=<name>` returns a
   coloured circle with the person's initials. No account required,
   fully automated, unique per name.
4. **Local fallback** if all of the above fail or we want zero
   third-party calls: render an SVG client-side with the first
   letter of the display name, color seeded from `id` for stable
   per-person colors.

**Pipeline.**

- Add `avatar_url TEXT` and `avatar_source TEXT` columns to `people`
  (migration). Populated lazily on first profile view: a
  `GET /api/people/:id/avatar` endpoint returns the URL (and caches
  the resolved choice on the row).
- A worker cron (or just call-on-fetch) that walks people without an
  avatar and runs the cascade. Cap requests to gravatar at ~5/s to
  stay polite.
- LinkedIn: avoid. The public API is gated and scraping their CDN is
  brittle and against TOS. Mention only in this doc; do not implement.

**UI.**

- `<PersonAvatar person={...} size={32} />` component. Tries
  `person.avatar_url`; on `<img>` error, swaps to the local
  initials-in-a-circle SVG so empty cards never flash. Used in
  the people list, profile header, and merge candidate cards.

**Privacy.**

- Don't transmit user emails to a third party in URLs. Gravatar uses
  the MD5 hash, which is fine. DiceBear takes a name seed (also fine
  — the name is already on screen). LinkedIn etc. are out.

---

## N. Person page: mailto:, Signal, iMessage links

**Why.** The fastest action after reading a person's profile is "send
them a quick note". A row of platform shortcuts removes the
copy-paste-switch-app dance.

**Goal.**

A "Contact" row in `PersonProfile.svelte` showing one icon button per
applicable channel for the person:

- **Email** — `mailto:<primary_email>?subject=<context-aware default>`.
  The subject can default to the person's most-recent open followup
  body if any, else blank. Body left empty.
- **Signal** — Signal supports `https://signal.me/#p/<E.164 phone>`
  links. Requires a phone number, which the schema doesn't currently
  store. Add `phone TEXT` to people (migration), and let the user
  enter / dictate it. Strip non-digits + ensure leading "+".
- **iMessage** — `sms:<E.164 phone>` opens the Messages app on iOS
  and Mac. Same phone source as Signal. (`imessage:` URI scheme
  is undocumented; `sms:` is the standard and routes to iMessage on
  Apple devices.)

**Implementation.**

- Migration: `ALTER TABLE people ADD COLUMN phone TEXT;`
- `PersonView` and `update_person` tool both gain a `phone` field.
- New `<ContactRow person={...} />` component in PersonProfile,
  rendering only the channels the person has data for. Each link
  uses `Icon.svelte` (mail, signal, message-square; add the icons to
  the set).
- Phone normalization helper: `toE164(raw)` — strip everything except
  digits and leading "+"; if no leading "+" and the number looks
  US/Canada (10 or 11 digits starting with 1), prepend "+1".

**Gotchas.**

- iOS only routes `sms:` to iMessage when the recipient is also on
  iMessage; otherwise it sends as SMS (which costs the user). Don't
  pretend it's iMessage-specific in the UI — label it "Message".
- Signal links with a phone number will silently fail in some
  browsers; that's fine, it's a fallback. The browser will offer to
  open Signal Desktop or the user will copy-paste.

---

## O. D1 backup + restore — cheap layered insurance

**Why.** Right now the people graph + meetings + transcripts live in one
Cloudflare D1 database with no backup story spelled out. A bad migration,
a destructive `DELETE` from the chat tool, or platform corruption could
wipe months of work. Cloudflare provides bookmarks and Time Travel
out of the box, but it's worth wiring an explicit weekly snapshot too.

**Three layers (free → near-free).**

1. **Cloudflare D1 Time Travel — built in.** Every D1 database can be
   restored to any point in the last 30 days (free plan) without
   pre-arranging snapshots. Two commands:

   ```bash
   # See available bookmarks (timestamps you can restore to):
   npx wrangler d1 time-travel info superconnector --remote
   # Roll back to a specific UTC time:
   npx wrangler d1 time-travel restore superconnector --timestamp=2026-04-29T12:00:00Z --remote
   ```

   No setup needed. Cost: $0. Coverage: any single bad migration / bug
   / "I just dropped that column" in the last 30 days.

2. **Weekly SQL export to R2 — ~$0/month at our scale.** Free R2 tier
   is 10GB storage / 1M Class A ops/month; a SQL dump of this DB is
   tens of KB, well inside that. Add a Worker cron + small script:

   ```ts
   // src/cron/backup.ts (new)
   const sql = await env.DB.prepare("SELECT sql FROM sqlite_master").all();
   // Plus: dump every table via wrangler-style "EXPORT" — D1 has an
   // export endpoint, but worker-side we iterate `SELECT * FROM` for
   // each user table and emit INSERTs. ~50 lines.
   const key = `superconnector/backups/${new Date().toISOString().slice(0,10)}.sql`;
   await env.BACKUPS.put(key, dumpSql);
   ```

   Add `[[r2_buckets]]` binding to wrangler.toml. New cron trigger
   `0 9 * * 0` (Sunday 09:00 UTC) — keep total cron triggers ≤ 5 to
   stay on the existing tier. Retention: 12 weeks (delete older
   keys at the end of each run). Total storage <1MB.

3. **Manual one-shot before risky migrations** — already supported via
   `wrangler d1 export superconnector --remote --output=backups/pre_$(date +%F).sql`.
   Document this in CLAUDE.md so any agent running a migration runs
   the export first.

**Restore drill (do this once now).** Take a backup with the manual
command, then `wrangler d1 execute --remote --command='CREATE TABLE
__test_restore (x INT); INSERT INTO __test_restore VALUES (1);'`,
verify the row, then run a Time Travel restore back to before the
test. Confirms the path works before we actually need it.

**Adjacent: chat-tool guardrails.** The MCP/chat exposes
`query_db_readonly` (refuses write keywords) and `update_person`,
but not `DELETE FROM ...`. Audit `src/tools/*` once and confirm
nothing exposes raw write SQL. The vector store re-embed path can
recover from a re-ingest, so it's not on the critical path.

**Touch points.**
- CLAUDE.md — add a "Backups" section pointing at the three layers
  and the manual command before migrations.
- src/cron/backup.ts (new) — weekly export-to-R2 worker.
- wrangler.toml — `[[r2_buckets]]` binding, new cron trigger.
- worker-configuration.d.ts — typed `BACKUPS: R2Bucket` binding.

**Cost.** $0/mo on the current plan (R2 free tier covers; 5 cron
trigger cap not exceeded; D1 free plan covers Time Travel).

---

## P. Notes detail: full transcript + investigate missing summaries

Two related bugs in the /notes detail pane:

### P1. Transcripts capped at 1500 chars

The current preview is sliced in `src/cron/ingest.ts` →
`transcriptToString(note.transcript)?.slice(0, 1500)` and stored on the
queue payload as `transcript_preview`. The Notes UI passes that 1500-
char string straight to `<NoteContent>`, which is why every transcript
seems truncated.

For **processed** items the full transcript is in `meetings.transcript`
(unsliced) — the page just isn't reading from there because the
Processed tab currently navigates straight to `/people/<id>` instead of
opening the same detail view.

**Fix.**

- For queue items (pending/dismissed): when the user opens the detail
  pane, lazily fetch the full note from Granola via a new server
  endpoint `GET /api/notes/granola/:noteId` that proxies to
  `granola.getNote(id)` and returns `{ summary, transcript_str }`.
  Replace the inline preview with the full transcript once loaded;
  show a subtle spinner inline while fetching.
- For processed items: same component, but read `transcript` from
  `meetings` directly via `GET /api/notes/meeting/:meetingId`.
- Keep `transcript_preview` on the queue payload as a snappy first
  paint while the full body streams in.

**Touch points.**
- `src/api/notes.ts` (new) — two GET endpoints above. Auth-gated.
- `pages/src/lib/components/NoteContent.svelte` — accept `noteId` and/or
  `meetingId` props; on mount, if the transcript is preview-only,
  fetch the full one and swap.
- `pages/src/routes/notes/+page.svelte` — pass the IDs through, drop
  the `transcriptIsPreview={true}` flag once the fetch lands.

### P2. Summaries not showing

User reports "no summaries showing" in the Note → Summary tab. Possible
causes, in order of likelihood:

1. **Granola Personal API doesn't include `summary` by default.** Our
   `getNote(id)` call uses `?include=transcript`. Granola may have a
   separate include for summary content (e.g. `?include=transcript,summary`
   or `?include=note_body`). Need to read the API docs and probe.
2. **Granola's "summary" field is named differently.** Some calendars
   call it `description`, `body`, `markdown`, `meeting_summary`, or
   `ai_summary`. Granola's app shows a markdown summary so the field
   exists; we just may be reading the wrong key.
3. **Summary is empty for this user's notes** because they don't run
   the summary step in the Granola app for every meeting. Less likely
   but possible.

**Investigation step (do first).** Hit the diagnostic endpoint with a
specific note id and dump every key on the response:

```
GET /api/run/check-granola?id=<noteId>
```

(Add an optional `id` parameter to that endpoint and return the full
JSON body for that note.) Whatever field actually carries the summary
becomes the new mapping in `src/lib/granola.ts`.

**Likely fix.** Update `GranolaNote` type and `getNote` query string
to pull both summary and transcript. Backfill: a one-shot admin
endpoint `POST /api/admin/refill-summaries` that re-fetches each
existing meeting's note and writes the now-correct summary to
`meetings.summary`.

---

## Q. Add-person page polish

Two layout fixes on `/people` and `/people/new`:

1. **`/people/new` should keep the left people list visible** (when
   the viewport is wide enough). Right now the page is a centered
   single column, so the user loses context — they'd want to see who
   already exists while they're describing a new contact, both to spot
   duplicates and to scan their own graph.

   Use the same two-pane layout as `/people/[id]`: the People list on
   the left (re-usable `<PeopleListSidebar>` extracted from
   `+layout`), and the chat-style add form on the right.

   On mobile (< 720px), keep the current single-column behavior
   so the chat takes the whole screen.

2. **`/people` add button → floating action button.** Move the
   "+ add" affordance out of the search row and make it a circular
   FAB pinned to the bottom of the people-list pane (or the viewport
   on mobile), centered horizontally.

   - Desktop: `position: absolute; bottom: 24px; left: 50%;
     transform: translateX(-50%);` inside the `.sidebar` (which
     becomes `position: relative`). Stays visible while the list
     scrolls.
   - Mobile: same pattern but anchored to the viewport
     (`position: fixed; bottom: 16px + safe-area-inset-bottom`).
   - Looks like a 48px circle with the `plus` icon centered.
     Accent color background, white icon. Light shadow.

   Remove the inline "+ add" button from the search row to avoid two
   affordances for the same action.

**Touch points.**
- `pages/src/routes/people/+page.svelte` — drop the inline button,
  add the FAB at the end of the sidebar (or as a sibling of the
  layout). Adjust .sidebar to `position: relative` on desktop.
- `pages/src/routes/people/new/+page.svelte` — switch to a two-column
  layout that mirrors `/people/[id]` on wide viewports.

---

## R. Modernize the any/all selector (tag combine mode)

`pages/src/routes/people/+page.svelte` currently uses a native `<select>`
with two options ("any", "all") for tag-match mode. It looks like a
form input out of the late-90s and gives no visual sense of which
mode you're in until you open it.

**Gold standard pattern: segmented control (a.k.a. pill toggle).**
Used by Linear, Notion, Apple's Settings — two connected pills,
exactly one filled. Always visible, one tap to flip.

```
┌────────────┬────────────┐
│  match any │ match all  │   ← currently "any" is filled
└────────────┴────────────┘
```

**Goal.**

A reusable `<SegmentedToggle>` component:

```svelte
<SegmentedToggle
  options={[
    { value: 'or',  label: 'Match any' },
    { value: 'and', label: 'Match all' },
  ]}
  bind:selected={tagMode}
/>
```

**Visual rules.**
- Single rounded container (`border-radius: 8px`), 1px border.
- Each segment is a button, equal-width via `flex: 1`.
- The selected segment fills with the accent color and white text.
- Unselected segments are transparent over the container's
  background, muted color.
- 28–32px tall — small enough to live inline with a label.
- `role="radiogroup"`, each option `role="radio"` with
  `aria-checked` and arrow-key navigation.
- Clicking the already-selected option is a no-op (don't toggle).

**Where to use it.**
1. Tag combine mode (`any` / `all`) — the immediate ask.
2. Future-friendly hookup point: role combine mode (currently OR
   only — add a similar toggle when role count grows).
3. Followups status filter on `/followups` (open / done /
   dropped — three segments).
4. Notes tabs on `/notes` are already this pattern manually; could
   be migrated to the same component for consistency.

**Touch points.**
- `pages/src/lib/components/SegmentedToggle.svelte` — new component.
- `pages/src/routes/people/+page.svelte` — replace the native
  `<select bind:value={tagMode}>` next to the "Tags" label.
- Optional: same in `/followups`.

**Polish.** Add a smooth ~120ms transform/background transition on
the selection move so flipping feels good — but respect
`prefers-reduced-motion`.

---

## S. Render assistant messages as markdown (with link prettifying)

**Why.** The chat assistant produces text like:

> Hale Guyer has been added to your CRM and linked to FAR Labs. You can
> find their profile at `/people/01KQG455PS1TB4FH2WSS6AMAWR`.

Right now `<ChatPane>` renders the assistant body as plain text inside a
`<div class="text">` with `white-space: pre-wrap`. So the path is
unclickable and the user sees a raw ULID. Two fixes:

1. **System prompt update.** Tell the assistant to write links as
   markdown with friendly anchor text — `[their profile](/people/<id>)`,
   not the raw path. Add this guidance to `SYSTEM_BASE` in
   `src/api/chat.ts`. Also instruct the model that, in `new-person`
   scope, the UI auto-redirects to the new profile, so a link is
   redundant — a one-line confirmation without a link is fine.

2. **Markdown rendering in `<ChatPane>`.** Replace the plain `{m.text}`
   with a parsed markdown render. Two paths:

   a. **Lightweight inline parser** (preferred — no dep): a tiny
      regex pipeline that handles **bold**, *italic*, `code`,
      `[text](url)` links, and paragraph/line breaks. ~40 lines, no
      package.
   b. **`marked` or `markdown-it` from npm.** Slightly bigger bundle
      but full coverage. Both are ESM-friendly with SvelteKit. Choose
      this if we ever want lists, headings, blockquotes.

   Either way: links from `mailto:` / `https?:` open in a new tab; same-
   origin links (`/people/...`) navigate via SvelteKit (use a click
   handler that calls `goto`). Sanitize: only allow `http`, `https`,
   and `mailto` schemes; never inject `<script>`.

**Touch points.**
- `src/api/chat.ts` (`SYSTEM_BASE`): add markdown-link guidance and a
  note about new-person redirect.
- `pages/src/lib/components/ChatPane.svelte`: swap `{m.text}` for a
  `<MarkdownView text={m.text} />` snippet.
- `pages/src/lib/components/MarkdownView.svelte` (new): minimal
  parser, sanitized output, internal-link interception.

---

## T. Dedupe queue inserts by Granola note id

**Why.** The Dismissed tab now shows duplicates — e.g. "Brainstorm AI
Opps" twice on Apr 24, "Blue Dot - TAIS Unit 6" twice, etc. They're not
visual artifacts; there are actual duplicate `confirmation_queue` rows.

**Cause.** `src/cron/ingest.ts` short-circuits via
`getExistingMeeting(sourceRef)` which only checks the `meetings` table.
A note that got *queued* (rather than processed into a meeting) leaves
no meeting row, so the next ingest tick — particularly any time the
high-water mark gets reset (manual repull, admin endpoint, etc.) —
inserts a second queue row for the same note. Over the lifetime of the
project this has clearly happened multiple times.

**Fix.**

1. **Pre-insert check** in both queue-paths (meeting_classification and
   person_resolution): before inserting, run
   `SELECT id FROM confirmation_queue WHERE kind = ?1 AND
   json_extract(payload, '$.note.id') = ?2 AND status = 'pending'
   LIMIT 1`. If a pending row already exists, update its `created_at`
   instead of inserting a fresh one. (Or, at minimum, no-op.)
2. **One-time cleanup migration** (`migrations/0007_dedupe_queue.sql`)
   that deletes duplicate dismissed/pending rows for the same
   `(kind, json_extract(payload, '$.note.id'))`, keeping the most
   recent. Run as a `DELETE FROM confirmation_queue WHERE id IN
   (SELECT id FROM confirmation_queue WHERE rowid NOT IN (...))` —
   simple keep-newest pattern.
3. **(Defense in depth)** Add a partial unique index:
   `CREATE UNIQUE INDEX uniq_queue_pending_note ON
   confirmation_queue(kind, json_extract(payload, '$.note.id'))
   WHERE status = 'pending';`. Prevents future regressions even if
   the application code forgets the check.

**Touch points.**
- `migrations/0007_dedupe_queue.sql` — cleanup + unique index.
- `src/cron/ingest.ts` — pre-insert check at both queue-insertion
  sites (meeting_classification and the two person_resolution
  branches).
- `src/lib/queue_resolve.ts` — also check before any queue inserts
  there (if any).

---

## U. Distinct home vs work location

**Why.** The `geo` column on `people` is a single string today, so when
the LLM extracts both "lives in Berlin" and "works at FAR Labs (Boulder)"
they collapse onto one line. The user wants these tracked separately so
filters and matches can reason about each.

**Schema.**

```sql
ALTER TABLE people ADD COLUMN home_location TEXT;     -- "Berlin, DE"
ALTER TABLE people ADD COLUMN work_location TEXT;     -- "Boulder, CO" or "Remote / FAR Labs"
ALTER TABLE people ADD COLUMN work_org TEXT;          -- the org name they work at, separate from `roles`
```

Keep `geo` for now — backfill into `home_location` on migrate, then
deprecate it in the ingest write path.

**Pipeline updates.**
- `extract.ts` EXTRACT_GUIDE: extend the schema with
  `home_location`, `work_location`, `work_org`, all optional.
- `people_writes.ts`: write the new fields when present; never
  blindly overwrite a populated field with a blank one.
- The Profile header's meta row currently shows `view.person.geo` —
  swap for two cells: "🏠 home_location" and "💼 work_org @ work_location".
- The merge reconciliation (`merge_people.ts`) needs to merge these
  three fields too (longer-of-two rule).

**Backfill.** Reprocess Tom McLeod (and anyone else with split-location
info already living in their context blob): a one-shot admin endpoint
`POST /api/admin/refill-locations?ids=<csv>` that re-runs extract on
their most recent meeting transcript with the new schema. Or simpler,
run `extract.ts` against each person's existing `context` text via
`source: 'manual'`.

---

## G. Ingest disposition log

To answer "do you have all the notes" the system needs an `ingest_log`
table that records every note id seen and what we did with it
(`processed`, `skipped_solo`, `skipped_group`, `queued`, `errored`,
`reprocessed`). Adds a fourth tab "Skipped" to `/notes` and lets the user
sanity-check that nothing is being silently dropped. Light schema; small
migration.

---

## T. Bulk add-people via the new-person modal

The current "add person" modal (`pages/src/lib/components/AddPersonModal.svelte`)
takes one person at a time. Add a tab in the same modal — "Single" /
"Bulk" — where the bulk tab is a textarea that accepts a freeform paste:
either a list of names, or rows of `name | email | one-line context | tags`,
or a Granola/calendar paste. Run it through Haiku to parse N people; for
each, call the existing `add_person` tool (or batch into one new
`add_people_bulk` tool that runs them in parallel).

UX detail: show a parsed-preview list before committing so the user can
de-select any rows the LLM mis-parsed. Skip-or-merge handling for emails
that already exist in the DB (offer "merge" or "skip" per row).

Touch points:
- `pages/src/lib/components/AddPersonModal.svelte` — tab UI + textarea + preview.
- `src/tools/people_mut.ts` — add `add_people_bulk` or call `add_person` in a loop.
- LLM prompt: tiny — "extract a JSON array of `{name, email?, context?, tags?}`
  from this paste; one object per person."

---

## U. Add-person submit is slow (~45s) and lacks loading state

Reproduce: open the new-person modal, fill in a single person (e.g.
"Tiffany Hopkins"), click submit. Observation: ~45 seconds before the
modal closes, and during the submit the button still shows the
default-pointer cursor instead of a spinner / `wait` cursor / disabled
state. User has no signal that anything is happening.

Two things to investigate, two things to fix:

1. **Where the time is going.** `add_person` should be a single D1 INSERT
   plus maybe an embed upsert. 45s suggests something is awaiting an LLM
   call (extraction? tag normalization? avatar fetch?). Tail
   `wrangler tail superconnector --format pretty` while submitting and
   look for slow steps. Likely culprits: (a) `resolveAndCacheAvatar` doing
   a synchronous HTTP fetch + image processing, (b) Workers AI embedding
   call, (c) something in the chat-pane creation flow on success.

2. **Fix the loading state.** In `AddPersonModal.svelte`, set a
   `submitting = $state(false)` flag before the `await api.post(...)`
   call, set it to true while awaiting, false in the finally. Apply
   `disabled={submitting}` to the submit button and `cursor: wait` on the
   modal. While we're at it, render a small inline spinner / "creating…"
   text so the user knows it's working.

Both items are independent — fix the UX feedback even if the underlying
slowness ends up being an LLM call we can't trim.

---

## V. Tags created with underscores keep coming back

**Repro:** chat-driven or extraction-driven tag creation produces names
like `open_to_cofounding` instead of `open to cofounding`. Happens
intermittently, probably correlated with the LLM being primed to emit
underscores by the prompt.

**Why it happens.** Two paths leak underscores past normalization:

1. **The extraction prompt itself promotes underscores.** `src/lib/extract.ts`
   has docstring examples like `"trajectory/exploring_founding"` and
   `"open_to_cofounding"` in the schema description it sends to Haiku.
   The model dutifully copies the style.

2. **`trajectory_tags_add` and `roles_add` arrays bypass `normalizeTagName`.**
   In `src/lib/people_writes.ts`, lines ~64, ~191, the arrays from
   `updates.trajectory_tags_add` and `updates.roles_add` are merged
   directly into the JSON column via `mergeArray()` without normalization.
   `normalizeTagName` is only called for the `tag_proposals` insert path
   (line ~136).

**Fix in two places:**

- Update `extract.ts`'s system prompt: change every example with an
  underscore to use a space (and make a single sentence-level rule
  "use spaces between words, never underscores; slashes are reserved for
  namespacing, e.g. `trajectory/raising seed`").
- In `people_writes.ts`, normalize every string flowing into trajectory
  tag / role JSON arrays. Add a `normalizeTagArray(strs)` helper next to
  `normalizeTagName` that maps + dedupes.

**Cleanup of existing data.** A one-shot admin endpoint
`POST /api/admin/normalize-tags` that:
- Iterates `tags`, `tag_proposals`, and every person's `trajectory_tags`
  + `roles` JSON arrays, applying `normalizeTagName`.
- For tags that collapse to the same canonical name (e.g.
  `open_to_cofounding` and `open to cofounding`), keep one row, repoint
  `person_tags`, delete duplicates.
- Idempotent.

After deploying, run it once and the historical underscores are gone.
With the extraction prompt fix in place, no new ones appear.

---

## W. Phantom `last_met_date` shows today instead of the real meeting date

**Repro:** open the profile of a person who hasn't had a meeting today —
e.g. Tiffany Hopkins. The header shows "last met 2026-04-30" (or whatever
today is) even though the corresponding `meetings` row's `recorded_at` is
months earlier. This recurs across many people; the dates cluster on
whatever day each ingest tick happened to run.

**Root cause.** `src/lib/people_writes.ts:57`:
```ts
).bind(now.slice(0, 10), now, personId).run();
```
`now` is `nowIso()` — the time at which `applyExtractionResult` runs, not
the time of the actual meeting. So every newly-processed Granola note
sets `last_met_date` to today, not to the note's `recorded_at`.

**Fix.**

1. Thread the meeting's actual recorded date into `applyExtractionResult`.
   Caller (`src/cron/ingest.ts` and `src/lib/queue_resolve.ts`) already has
   `note.created_at` / the meeting's `recorded_at`; pass it as
   `meetingRecordedAt: string` on the args object.
2. In the function body, use `meetingRecordedAt.slice(0, 10)` for
   `last_met_date`, not `now.slice(0, 10)`.
3. Don't blindly overwrite — `MAX(existing last_met_date, this meeting's
   date)` so older meetings ingested later don't *back-date* the field
   (the user's most-recent-meeting indicator should always reflect the
   most recent actual meeting, not the most recently *ingested* one).
   Equivalent SQL:
   ```sql
   SET last_met_date = COALESCE(
     CASE WHEN last_met_date IS NULL OR ?1 > last_met_date THEN ?1 ELSE last_met_date END,
     ?1
   )
   ```
4. **Backfill admin endpoint.** `POST /api/admin/backfill-last-met` that
   for every person sets `last_met_date = (SELECT MAX(recorded_at) FROM
   meetings WHERE person_id = people.id)` and `meeting_count = (SELECT
   COUNT(*) ...)`. One-shot cleanup of already-corrupt rows. Idempotent.

This bug also taints any logic that relies on `last_met_date` (the
"magical" sort, "stale-active" weekly digest section, follow-up nudges).
Worth fixing before any of those features mature.

---

## X. Profile auxiliary actions menu (merge / delete behind a caret)

The "Merge with…" action is currently an always-visible button at the top
of the profile. Move it (and a destructive "Delete person" option, which
doesn't exist yet) into a single dropdown caret in the top-right of the
profile header — common pattern for low-frequency auxiliary actions.

- New `<button class="caret">⋯</button>` in `PersonProfile.svelte`'s
  header. Clicking opens a small popover with: "Merge with…", "Delete
  person".
- Delete needs a confirmation step ("Type the name to confirm"), and on
  the backend a new `delete_person` tool / endpoint that also cascades
  through `person_tags`, `signals`, `followups`, `chat_threads`,
  `chat_messages`, `meetings.person_id` (probably hard-delete; we don't
  have a soft-delete column today).
- Pull the existing merge UI out into a child component so the dropdown
  can mount it on demand.

---

## Y. Headline card: hide empty fields; "Add work location" icon; edit-mode

Top card on a profile currently shows every header field even when empty,
and the "Add work location" affordance has no icon (just text). Three
small fixes:

1. **Conditional render.** If a header field is null/empty (e.g. work
   location, geo, role chips), don't render its row at all when in
   read-mode. Empty placeholders make sparse profiles look cluttered.
2. **Add a location icon** next to "Add work location" / location
   display. Same treatment as the email/phone icons. Inline SVG, no
   icon library needed.
3. **Explicit edit mode.** Today, fields appear inline-editable on hover
   or focus. Switch to: a small pencil icon top-right of the card that
   toggles a `editing = $state(false)` flag. When false, render
   read-only with empty fields hidden. When true, render every field as
   an editable input (so the user can fill in the previously-hidden
   ones). Save on blur or on toggling back.

Touch points: `PersonProfile.svelte` header section.

---

## Z. Hide "Add followup" form behind a subtle right-aligned button

The followup composer in the profile is always-visible and takes vertical
space even when there's nothing to add. Replace the form with a small
right-aligned `+ followup` button; clicking expands the form inline. Same
pattern as a chat composer's attachment menu — discoverable, but not
demanding.

`PersonProfile.svelte`, followups section.

---

## AA. Soften "me" chat bubble contrast

Per-person and master chat bubbles for the user's own messages currently
use high-contrast (e.g. accent-on-white or black-on-white). Switch to a
medium-gray background with black text — closer to iMessage / Notion
inline-comment style. Less visual weight; lets the assistant's reply
read as the focal content.

Touch points: `pages/src/lib/components/ChatPane.svelte` and any
shared message-bubble styles. Likely just a CSS variable swap.

---

## AB. Editable signals

Signals (the per-meeting extracted facts on a profile) are currently
read-only. Make them inline-editable: click the body text to edit, save
on blur, plus a small `×` to delete. Also surface a "+ signal" button
under the signals list for manual additions.

Touch points:
- `PersonProfile.svelte` signals section.
- `src/api/people.ts` (or a new `src/api/signals.ts`) — PATCH and DELETE
  routes for `signals` rows; restrict to signals belonging to the
  authed user's people graph (single-user, so trivially true today).
- New tools `update_signal`, `delete_signal`, `add_signal` so chat can
  hit them too.

Caveat: signals carry a `confidence` and a provenance link to a meeting.
When the user edits, set `confidence = 1.0` and keep the original
`meeting_id` so we don't lose the audit trail. When the user adds
manually, leave `meeting_id` null.

---

## AC. Rename signal kind label "status change" → "Status"

Cosmetic. The schema has a `signals.kind` enum including `status_change`;
the UI renders it verbatim ("status change"). Change the rendered label
to **Status** (Title-cased, single word) wherever signal kinds are shown.
Don't touch the database value — just the display map in the frontend.

Touch points: search the SvelteKit app for `'status_change'` and replace
with a small `KIND_LABELS` map: `{ need: 'Need', offer: 'Offer',
status_change: 'Status', commitment: 'Commitment', note: 'Note' }`.

---

## AD. People list left-pane: drop the metadata row

The people list currently shows a second line per row with last-met
date, meeting count, and tag preview. It's noisy at scan-time and
duplicates info already on the profile. Strip the second line entirely
in `PeopleList.svelte`; render only the name (and an avatar if AT-M
lands). Filtering and sorting still happen in the sidebar above; users
who want the metadata click into the profile.

Keep the underlying API response unchanged — it's just a render-side
edit in `pages/src/lib/components/PeopleList.svelte`.

---

## AE. Keyboard shortcuts: add-person, search, person-chat focus

Three shortcuts and their visible affordances:

1. **`A` (or ⌘N) opens the add-person modal.** Show the shortcut on the
   button itself, e.g. `+ Add person  A` or `⌘N` in a small kbd badge
   next to the label.
2. **`/` focuses the people-list search field.** Show the `/` hint inside
   the input as a right-aligned kbd badge that disappears when focused.
   Common pattern; users will recognise it.
3. **`C` focuses the per-person chat composer.** Show the hint as a kbd
   badge inside the textarea placeholder ("Ask about this person…  `C`").
   When the chat composer is anchored (see AF), the shortcut works from
   anywhere on the profile.

Implementation: a single `<svelte:window onkeydown={…}>` in
`pages/src/routes/+layout.svelte` (or inside each route that needs them).
Don't fire when the active element is a textarea/input — use
`event.target.tagName` or `closest('input,textarea')`.

---

## AF. Person chat: anchor composer to viewport bottom; add 'C' shortcut

The per-person chat composer in `PersonProfile.svelte` currently scrolls
with the rest of the right pane, so on long profiles you have to scroll
to send a message. Pin the composer to the viewport bottom (or to the
bottom of the right pane, whichever feels right). Keep the message
history scrollable in place above it — only the composer is sticky.

Implementation: wrap the chat-pane composer in a `position: sticky;
bottom: 0; background: var(--bg);` container with a small top shadow
to separate it from the history. Make the message-history container a
`flex: 1` overflow-y: auto so it takes the remaining space.

Combine with AE.3 — pressing `C` from anywhere on the profile focuses
the now-always-visible composer.

---

## AG. Search: top result auto-loads in the right pane

While typing in the people-list search field, debounce ~150ms; whenever
the filtered list refreshes, if the current right-pane person isn't in
the results anymore, navigate to the top result automatically.
`PeopleList.svelte` already emits `onSelect`; the `+page.svelte` (or
+layout.svelte) for the people route can watch the `items` array
post-filter and call `goto(/people/<top.person_id>)` when the active id
isn't present.

Edge cases:
- Empty results → leave the right pane on the previous person (don't
  navigate to a 404).
- Don't auto-navigate when the user has manually clicked a row that
  also matches the search; only navigate when the active person is no
  longer in the filtered set.

---

## AH. Title-case the global "chat" button

`MasterChatDrawer.svelte` (or wherever the top-bar chat button is)
currently labels the button `chat ⌘K`. Title-case to `Chat`. One-line
change.

---

## AI. Name disambiguation + duplicate-prevention queue

Today, person creation goes through `resolvePerson` (`src/lib/resolve.ts`)
which:
- exact-matches on email,
- exact-matches on `display_name` (case-insensitive),
- LIKE-matches on first/last token if no exact hits,
- creates a new row otherwise.

Two failure modes:

1. The user adds "Tom McLeod" via the modal and there's already a "Tom"
   in the DB (different last name) — current resolver creates a new row;
   if it's *actually* the same Tom, we now have a dupe.
2. Granola ingest creates "Sarah Chen" from a calendar attendee email,
   and a chat dictation later mentions "Sarah" without an email — the
   LIKE match might collide with someone else named Sarah, or might miss
   the existing row if the dictation said only "Sarah" without context.

**Goal.** Whenever person creation or update is about to happen, run a
match pass that surfaces *any plausible candidate*, including first-name
matches. If one or more candidates exist, **don't silently create or
silently merge** — enqueue a `person_disambiguation` confirmation_queue
item asking the user to either pick an existing person, confirm a new
one, or merge.

**Design sketch.**

1. New helper `findDisambiguationCandidates(env, {name?, email?})` in
   `src/lib/resolve.ts` (next to `fuzzyByName`). Returns:
   - exact email matches (highest signal),
   - exact display_name matches (high),
   - first-token matches (lower signal — "Tom" → every Tom),
   - last-token matches,
   - aliases JSON column matches.
   Each candidate carries a `match_kind` and a numeric score so the UI can
   render reasons ("matches first name", "shares email domain", etc.).
2. Update `resolvePerson` callers:
   - **Granola ingest** (`src/cron/ingest.ts`): when an email is present
     and matches exactly, proceed (high confidence). When name-only
     matching surfaces ≥1 candidate, enqueue a `person_disambiguation`
     item with `{candidates, proposed_attrs}` rather than auto-create.
   - **`add_person` tool** (`src/tools/people_mut.ts`): same — if any
     candidate exists, queue instead of insert. Return
     `{queued: true, queue_id}` to the caller.
   - **`dictate` tool**: same.
3. New queue kind `person_disambiguation` with payload:
   ```ts
   {
     proposed: { name?, email?, initial_context?, ... },
     candidates: Array<{
       person_id, display_name, primary_email,
       match_kind: 'email' | 'display_name' | 'first_token' | 'last_token' | 'alias',
       score: number,
       last_met_date, meeting_count
     }>,
     source: 'add_person' | 'dictate' | 'granola',
     source_ref: string | null
   }
   ```
4. Resolution actions in `src/api/queue.ts`:
   - `decision: 'use_existing'` + `selected_person_id` — apply `proposed`
     attrs to that row (via `update_person`), discard the new candidate.
   - `decision: 'create_new'` — proceed with the original create.
   - `decision: 'merge'` + `keep_id` + `merge_id` — handles the post-hoc
     dupe case where two rows already exist (use `mergePeople`).
5. UI: extend the queue page (`pages/src/routes/queue/+page.svelte`) with
   a `person_disambiguation` renderer. Show proposed attrs vs each
   candidate side-by-side with action buttons.
6. Also keep the existing rank-based "Merge with…" affordance on the
   profile (TODO X already shipped) so the user can clean up duplicates
   they create deliberately.

**Edge cases / gotchas.**
- `add_person` from the modal currently does its work via the new-person
  chat stream. The modal's "Adding…" state needs to handle the
  "queued for disambiguation" reply gracefully — show a toast linking to
  the queue rather than navigating to a non-existent person.
- Granola ingest is async; queueing here is fine (no user blocking).
- First-token-only matches will be noisy. Make them dismissible with
  one click; don't pile up "Sarah" disambiguations every time a
  different Sarah appears. Consider a `dont_disambiguate` per-pair
  preference: once the user picks "create new" for proposed=Sarah
  Chen vs candidate=Sarah Lee, remember the (Sarah Chen) email/name
  combo and skip the prompt next time.
- Privacy: don't surface raw transcripts in the queue payload — names,
  emails, and one-line summaries only. The transcript stays on the
  meeting row.

---

## AJ. LLM voice: address the user as "you", not "User"

Across every LLM-touching surface (extraction prompts, chat system
prompts, plays, draft-intro, daily email rendering), when content is
*about* the user (the Me person, identified by `EMAIL_TO`), it should be
written in the second person ("You met Sarah at …", "You're raising
seed") — not third-person ("User met Sarah", "The user's organization").
The user is the only reader, so second-person is correct.

**Why this matters.**
The chat replies, daily-email briefs, and signal bodies currently leak
"User" / "the user" / third-person voice in places. It reads
clinical and out-of-character for a personal assistant.

**Where to fix.**

- **`src/lib/extract.ts` (`EXTRACT_GUIDE`)** — for `user_updates` /
  `user_signals`, instruct the model to write context_delta and signal
  bodies in the second person ("You said you're leaving FAR Labs",
  not "User said the user is leaving FAR Labs"). The counterpart's
  fields stay third-person ("Sarah is exploring founding").
- **`src/api/chat.ts`** — system prompt should bind a `me` block
  describing the Me person and explicitly instruct: "When the user
  refers to themselves or to 'me', it means {me.display_name}. Refer
  to them as 'you' when writing about them; refer to other people in
  the third person."
- **`src/plays/brief.ts`** — briefing template renders to the user; any
  reference to the user themselves should be "you".
- **`src/plays/ways_to_help.ts`** — same.
- **`src/cron/daily_email.ts`** — already addresses the user
  conversationally ("Today — 2026-04-30"); audit for any "the user"
  slips and replace.
- **`src/tools/draft_intro.ts`** — drafts go *from* the user, so when
  signing or referencing the sender, it's second-person.

**Implementation note.** Rather than peppering second-person rules
across every prompt, define one shared system block in
`src/lib/anthropic.ts` (something like `aboutTheUserBlock(me)`) that
describes the Me person and the voice rules, and prepend it as a
cached system block on every Claude call. Anthropic's prompt-caching
will share it across calls so the cost is amortized.

**Verification.** Trigger `POST /api/run/daily-email` and a few chat
queries after deploy and grep the rendered output for "user". Should be
zero matches in user-facing surfaces (it's fine in code/logs).

---

## AK. "Recent meeting" appears for people we haven't actually met

**Symptoms (2026-04-30):**
- Yoav Tazfati profile shows a recent meeting; user has only an
  *upcoming* calendar invite for tomorrow.
- Tom McLeod profile shows a recent meeting; user added him via chat
  ("We met at Blue Dot Dinner on Feb 20") but no actual meeting row
  should exist dated Feb 20.

**Two distinct root causes:**

1. **Granola auto-creates notes for upcoming calendar events.** When
   the user has a calendar invite (e.g. tomorrow), Granola's app
   pre-creates a note bound to that event. Our ingest pulls every
   note whose `created_at` is after the high-water mark and
   materializes a `meetings` row regardless of whether the meeting
   has actually happened. So upcoming events leak in as "past
   meetings".

   **Fix.** In `processNote` (`src/cron/ingest.ts`) and
   `materializeFromGranolaNote` (`src/lib/queue_resolve.ts`):
   ```ts
   // If the note is bound to a calendar event whose start time is in
   // the future, skip — re-ingest after the meeting actually happens.
   const start = note.calendar_event?.start_time;
   if (start && new Date(start).getTime() > Date.now()) {
     await logDisposition(env, note, 'skipped_future_event',
       `event starts ${start}, meeting hasn't happened yet`, null, null);
     return 'skipped';
   }
   ```
   Don't advance the high-water mark past these — they need to be
   re-fetched on a later tick. Easiest: don't update `lastRef` when
   we skip for this reason. Actually simpler: the existing
   `getExistingMeeting` lookup will skip duplicates next tick anyway,
   so just process them when the start time has passed.

   Also: a **transcript-presence sanity check** as belt-and-braces —
   if a note has no transcript at all and `calendar_event.start_time`
   is in the future or < 60 minutes ago, skip. A real meeting
   produces a transcript.

2. **`dictate` tool stamps `meetings.recorded_at = now`** even when
   the dictation describes a past meeting. So `Tom McLeod, met Feb 20`
   becomes a meeting dated today.

   **Fix options.**
   - **Cheap**: stop creating a `meetings` row from `dictate`. The
     dictation is annotation about the *person*, not a meeting record.
     Apply the extracted updates directly to the person row; skip
     the meetings INSERT. Signals can attach to a synthetic
     `meeting_id` column or, better, allow `signals.meeting_id` to be
     null (it is) and just set `kind='note'` for dictation-derived
     facts.
   - **Better**: extract a date from the dictation when present
     ("Feb 20", "yesterday", "last Tuesday") via Haiku, stamp
     `recorded_at` accordingly. Fall back to `now` only when no date
     is detectable.

**Backfill / cleanup.**

One-shot admin endpoint
`POST /api/admin/cleanup-future-meetings` that finds rows where
`event_start > now()` (or `recorded_at > now()`), and either deletes
them or pushes them to a `pending_future` status so the user can
review. Single-user scale: a handful of rows max.

For dictation-stamped meetings already inserted with `now`: these are
harder to detect because there's no signal that distinguishes them
from a legitimate same-day meeting. Best we can do is: list every
meeting with `source = 'user_dictation'` and `recorded_at = created_at`
(within seconds), and surface them in an admin view for the user to
manually fix or delete.

**Touch points.**
- `src/cron/ingest.ts` — `processNote` future-event guard.
- `src/lib/queue_resolve.ts` — same guard.
- `src/tools/dictate.ts` — either drop the meeting row or detect a
  date.
- `src/index.ts` — admin endpoint.
- `src/lib/ingest_log.ts` — add `'skipped_future_event'` to the
  Disposition union.

**Knock-on effects.**
- The "Today's meetings" section of the daily email is read from ICS
  directly, not from `meetings`, so it's unaffected.
- The "magical" sort uses `last_met_date` which TODO W's backfill
  endpoint already recomputes from `meetings.recorded_at`. After this
  fix lands, run `/api/admin/backfill-last-met` again.

---

## AL. Persist people-list sort + filters across refreshes

The People sidebar (`pages/src/routes/people/+layout.svelte`) holds
`sort`, `tags`, `roles`, `tagMode`, and `q` as `$state` — they reset on
every page load. User wants them to survive refreshes / browser restarts.

**Approach.** localStorage, keyed under a single object so we
serialize once.

```ts
// Init from storage on mount (typeof window guard for SSR safety).
const KEY = 'superconnector:people-list-state-v1';
type Persisted = { sort: SortMode; tags: string[]; roles: string[]; tagMode: 'and'|'or'; q: string };
function load(): Partial<Persisted> {
  if (typeof localStorage === 'undefined') return {};
  try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
const saved = load();
let sort = $state<SortMode>(saved.sort ?? 'magical');
let tags = $state<string[]>(saved.tags ?? []);
// ...

// Save whenever any input changes.
$effect(() => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify({ sort, tags, roles, tagMode, q }));
});
```

**Edge cases.**
- Don't persist `q`: search text feels stale on a fresh load. Decide
  case-by-case; user said "sort and filters", so probably skip search.
- Bump the `KEY` version (`-v1` → `-v2`) when the persisted shape
  changes — old entries become unreadable and we silently fall back.
- The same-origin Pages worker means localStorage works as expected
  per-domain; no Workers KV needed.

**Touch points.**
- `pages/src/routes/people/+layout.svelte` — load on init + save in an
  $effect.
- Optionally also persist `chatHistoryVisible` in PersonProfile for
  the same reason.

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
