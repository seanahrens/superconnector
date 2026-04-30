# gotchas — hard-won learnings

Things that cost real time to figure out. Read before you re-discover them.

## Granola API

- **Base URL is `https://public-api.granola.ai/v1`**, not `api.granola.so` (that
  domain doesn't even resolve). Source of truth: `https://go.granola.ai/api-docs`,
  also extractable from `/Applications/Granola.app/Contents/Resources/app.asar`.
- **Personal API key** prefix is `grn_`. Auth is `Authorization: Bearer grn_…`.
  Personal API only returns notes the user owns or has access to; `attendees`
  in the response will only contain the owner themselves on solo notes.
- **`transcript` is an array of speaker turns**, not a string. Each turn is
  `{text, start_time, end_time, speaker?: {source, diarization_label}}`. The
  list endpoint omits transcripts; you must fetch each note with
  `?include=transcript` to get them. Use `transcriptToString()` from
  `src/lib/granola.ts` to fold to a single string before storing in D1 or
  passing to the extraction LLM. Storing the array directly in a D1 bind
  silently goes wrong because D1 doesn't accept arrays.
- **`calendar_event` is the source of truth for attendees** when present. The
  top-level `attendees` field on a note from the Personal API only contains
  the owner. Real meeting attendees live in `calendar_event.attendees`. Use
  this in preference to ICS time-window matching when available.
- **Solo notes** (calendar_event=null AND only-owner-attendees) are personal
  brainstorming notes; they don't belong in the people graph. Detect with
  `isSoloNote()` and skip silently in `processNote`.
- Rate limits: 25 req / 5s burst, 5 req/s sustained. Budget 1 list call + 1
  detail call per new note per 5-min ingest tick.

## Cloudflare quirks

- **Pages app is deployed as a Worker with static assets**, not a classic
  Pages project. `wrangler pages project list` does not show it. Find the URL
  via `npx wrangler deployments list --name superconnector-pages` or just
  visit `https://superconnector-pages.<account>.workers.dev`.
- **Cron triggers** are capped at 5 per account on the free plan. The user
  upgraded to Workers Paid after we briefly built `cron-hub/` to fan out.
  cron-hub is dormant code — keep it as a fallback if the cap hits again.
- **Email Routing must be enabled on the sending domain manually.** The setup
  script can't automate this. The destination address (`EMAIL_TO`) must also
  be verified as a destination in Email Routing. Until both are done, the
  daily-email cron will silently drop sends. The setup script's "Next steps"
  printout reminds the user to do this.
- **`fetch()` from a Worker resolves DNS through Cloudflare's network.**
  Domains that don't have public A/AAAA records will throw `530 / error code
  1016`. We hit this when the original Granola URL was wrong.

## MCP

- **Use `inputSchema` (camelCase) for the MCP `tools/list` response**, not
  `input_schema` (Anthropic's snake_case format). Mixing them up makes Claude
  Desktop / `mcp-remote` silently discard every tool with the message "this
  connector has no tools available." See `src/tools/types.ts` for the two
  separate converter functions.
- Handle `notifications/initialized` — the spec says the client sends it
  after `initialize` and expects no error. Falling through to "method not
  found" can confuse some clients.
- **Claude Desktop must be fully quit (⌘Q)** to pick up MCP server config or
  schema changes. Closing the window keeps it running in the background.
- `mcp-remote` runs locally on the user's Mac and proxies to our Worker; the
  config in `~/Library/Application Support/Claude/claude_desktop_config.json`
  passes the `Authorization` header via `--header`.

## Person resolution

- **Never call `resolvePerson({email: null, name: null})`.** It silently
  creates phantom rows with no identifying info. The current `processNote`
  routes the no-info case to `confirmation_queue` instead. If you write a new
  ingestion path, do the same.
- Fuzzy name match is intentionally cheap (case-insensitive exact, then a
  LIKE on first/last token). Single-user scale; don't over-engineer.
- `aliases` JSON column carries name variants. When merging, append to it
  rather than replacing.

## Ingest pipeline shape

The cron path in `src/cron/ingest.ts`:

1. `granola.listNotes({created_after: highWaterMark, limit: 50})` — light list
2. For each new note: `granola.getNote(id)` to get the transcript.
3. `isSoloNote(...)` → skip if true.
4. Determine attendees: prefer `note.calendar_event.attendees` filtered to
   exclude user/owner. Fall back to ICS time-window match (±15 min around
   `note.created_at`).
5. `classifyMeeting(...)` — fast path when 0/1/many attendees known, else LLM.
6. group → skip; ambiguous → confirmation_queue; 1:1 → continue.
7. Pick counterpart, `resolvePerson(...)`, ambiguous → queue.
8. INSERT meeting row (transcript folded to string).
9. `extractFromMeeting(...)` (Haiku) → `applyExtractionResult(...)`.
10. Update high-water mark to the latest `note.created_at` seen.

If you break this, the symptoms are usually: phantom unknown people, queue
flooded with `meeting_classification` items, or the high-water mark not
advancing (so next tick re-fetches the same notes).

## Setup script

- `set -o pipefail` + `yes |` is a footgun: when the consumer (e.g. wrangler
  with no migrations to apply) exits before reading any input, `yes` gets
  SIGPIPE and pipefail kills the whole script with no useful output. Use
  `printf 'y\n' |` to deliver exactly one line.
- Capturing wrangler output with `out=$(wrangler deploy 2>&1)` hides errors;
  the user sees nothing on failure under `set -e`. Use `tee` and check
  `${PIPESTATUS[0]}`.
- Wrangler colourised output contains ANSI escapes and `\r`. Strip them
  before grepping for URLs and especially before writing them into TOML —
  control characters in TOML strings are illegal and parsing fails far from
  the source. Pass values into helper Node scripts via `process.env` and
  sanitise inside JS.
- The user's Mac has its own clone of this repo. Agents work on a sandboxed
  remote clone. Pushing to GitHub doesn't update the user's local files. If
  the user runs `wrangler deploy` without `git pull` first, they ship the
  old code and the `Current Version ID` won't really change.

## Filesystem boundaries (for agents)

- An agent in this sandbox can read/edit `/home/user/superconnector/` only.
  `/Applications/...`, `~/Library/...`, the user's `.secrets/` directory, and
  anything else on the user's Mac is **invisible**. When you need to inspect
  those, ask the user to run a command and paste the output.
- The user runs `wrangler` for you. You can suggest commands but not execute
  them against the live Cloudflare account.

## Web UI gotchas

- SvelteKit 2 with Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`).
- `$env/static/public` would force public env vars to be known at build time
  and that doesn't work for our flow; we use `$env/dynamic/public`.
- `<option />` self-closing tags fail `svelte-check`. Use explicit
  `<option></option>`.
- The Pages worker uses `adapter-cloudflare` v7 (v4 demands wrangler ^3 and
  conflicts with our wrangler 4).
