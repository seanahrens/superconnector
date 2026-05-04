# superconnector — agent handoff

If you are an AI agent picking up this repo for the first time: read this file
and `docs/GOTCHAS.md` before changing anything. Both contain context that took
real time to discover and is not deducible from the source alone.

## What this is

A single-user, AI-native CRM for Sean Ahrens. The user is a field-builder in
the AI safety community; the tool's purpose is to convert his meeting flow
(via Granola) and calendar (via Proton ICS) into a structured people graph,
then surface high-fit matches (cofounders, funders, talent) and brief him for
his upcoming meetings via a single daily email.

Not a multi-tenant SaaS. Not a self-serve product. A personal force-multiplier
that augments the user's own connector role and keeps relationship credit with
him.

Original architecture spec is checked in at the top of `README.md`'s linked
plan; this file plus `docs/GOTCHAS.md` plus `docs/TODOS.md` cover everything
that's been learned and decided since.

## Stack at a glance

| Layer | Tech |
|---|---|
| Worker (API + cron + MCP) | Cloudflare Workers, Hono, TypeScript |
| Relational store | Cloudflare D1 (SQLite + FTS5) |
| Vector store | Cloudflare Vectorize (768-dim, bge-base-en-v1.5) |
| LLM | Anthropic API (Haiku 4.5 extract, Sonnet 4.6 match/draft, prompt-caching) |
| Email | Cloudflare Email Workers (`[[send_email]]`) — not Resend |
| Web UI | SvelteKit on Cloudflare Pages (deployed as a Worker with static assets, *not* a classic Pages project) |
| Schedule | Workers Cron Triggers (`*/5 * * * *` ingest, `0 13 * * *` daily email at 06:00 PT) |
| MCP | Custom JSON-RPC 2.0 over HTTP (Streamable HTTP transport, 2025-03-26 spec) |
| Cron-hub (optional, currently unused) | `cron-hub/` subproject — fan-out cron for many projects under one trigger slot |

## Top-level layout

```
src/                    Worker (API + cron + MCP)
  index.ts              Entrypoint: health, mcp, /api/* routes, scheduled handler
  cron/                 ingest, daily_email, backup
  lib/                  Domain primitives (see "lib map" below)
  plays/                brief, match, ways_to_help, weekly_digest
  role_packs/           founder/funder/talent/advisor JSON
  tools/                15 tools shared by MCP + web chat — single registry in tools/index.ts
  mcp/                  JSON-RPC server (one file)
  api/                  Hono routes mounted under /api/* (admin, diagnostics, people, queue, …)
migrations/             D1 SQL migrations
pages/                  SvelteKit app, deploys as superconnector-pages worker
scripts/setup.sh        Idempotent one-shot provisioner — read this before changing infra
cron-hub/               Standalone Worker; multi-project cron fan-out (not currently active)
docs/                   GOTCHAS.md, TODOS.md
```

### lib map

| Module | Responsibility |
|---|---|
| `lib/db.ts`              | D1 row types (`PersonRow`, `MeetingRow`, …) + `AttendeeRef` + JSON-column helpers (`parseJsonArray`, `parseJsonObject`, `mergeStringArray`, `uniqStrings`) + `sqlPlaceholders` for `IN (…)` clauses |
| `lib/api_types.ts`       | Worker → Pages JSON shapes (`PersonListItem`). Pages mirrors these in `pages/src/lib/types.ts` — edit both when adding fields |
| `lib/people_repo.ts`     | `getPersonById` (canonical one-line `SELECT *` lookup) + `createPerson` (the full INSERT) |
| `lib/me.ts`              | `findMePerson`, `ensureMePerson` — the user's own row (matched by EMAIL_TO) |
| `lib/resolve.ts`         | Email-then-fuzzy person resolution; creates new rows via `createPerson` |
| `lib/meetings.ts`        | `insertMeeting`, `updateMeetingFromNote`, `findMeetingBySourceRef`, `recomputePersonMeetingStats` |
| `lib/queue.ts`           | `enqueueConfirmation`, `hasPendingForNote`, `setQueueStatus` — confirmation_queue writes |
| `lib/extraction_context.ts` | Loads the "person view" the LLM extractor needs (counterpart + Me) |
| `lib/people_writes.ts`   | `applyExtractionResult` — merges an extraction into a person row + signals + followups + tag proposals |
| `lib/extract.ts`         | Anthropic Haiku extraction call shape + result types |
| `lib/classify.ts`        | Three-signal vote + LLM classifier for meeting type + counterpart name |
| `lib/granola.ts`         | Granola Personal API client + transcript folding + content hashing |
| `lib/ics.ts`             | ICS parser + time-window event matching |
| `lib/anthropic.ts`       | Claude SDK plumbing — `getClient`, `cached`, `jsonCall`, model constants |
| `lib/merge_people.ts`    | Merge-candidate ranking + Haiku-reconciled person merge |
| `lib/avatars.ts`         | Gravatar → DiceBear cascade with caching |

### api map

| Module | Responsibility |
|---|---|
| `api/auth.ts`            | `requireAuth` middleware (Bearer WEB_AUTH_SECRET, fails CLOSED in prod) |
| `api/errors.ts`          | `asJson` wrapper — turns thrown errors into JSON 500s for routes |
| `api/admin.ts`           | `/api/admin/*` repair endpoints (cleanup-phantoms, normalize-tags, repull-granola, …) |
| `api/diagnostics.ts`     | `/api/run/check-{ics,granola}` read-only upstream probes |
| `api/people.ts`          | List/detail/edit, reorder, merge candidates + merge action, avatar resolve |
| `api/queue.ts`           | confirmation_queue read + `/:id/resolve` (deferred-ingest finisher) |
| `api/notes.ts`, `tags.ts`, `followups.ts`, `chat.ts`, `digest.ts` | thin route layers over tools / SQL |

## Auth model (post 2026-04-29)

- **Pages worker** is gated by HTTP Basic Auth in `pages/src/hooks.server.ts`.
  Browser prompts natively. Password = `WEB_AUTH_SECRET` (any username).
  Fails CLOSED with 503 if the secret is unset.
- **Browser → API** flows through a same-origin server-side proxy at
  `pages/src/routes/api/[...path]/+server.ts`. It dispatches to the Worker
  API via a **service binding** (`pages/wrangler.toml` `[[services]]`,
  binding `WORKER_API`, service `superconnector`) and attaches
  `Authorization: Bearer <WEB_AUTH_SECRET>` from `$env/dynamic/private`. The
  bearer never reaches the client. The old `PUBLIC_API_TOKEN` is gone — do
  not reintroduce it. **Do not "fix" this by switching back to HTTP fetch
  on `*.workers.dev`** — Cloudflare returns its generic 404 placeholder
  ("There is nothing here yet") for worker-to-worker subrequests on the
  public hostname; service bindings are the only reliable path.
- **MCP** uses its own `MCP_SECRET` bearer; both this and `requireAuth` now
  fail CLOSED if their secret is unset and `ENVIRONMENT !== 'development'`.
- The Worker no longer ships a CORS allow-list — all browser traffic is
  same-origin via the Pages proxy.

## Where to start when troubleshooting

1. **Worker logs** — `npx wrangler tail superconnector --format pretty`. The
   user's local machine has the bindings; agents in sandboxed envs cannot
   tail. Ask the user to run it.
2. **Diagnostic endpoints** (auth-gated by `WEB_AUTH_SECRET`):
   - `GET  /health` — DB reachability
   - `GET  /api/run/check-granola` — probes the Granola API and returns
     `{status, body}` so you can see what the upstream actually returns
     without redeploying debug code.
   - `POST /api/run/ingest` — fire the 5-min cron path manually
   - `POST /api/run/daily-email` — fire the daily email path manually
3. **Admin endpoints** for resetting state without dropping the DB:
   - `POST /api/admin/cleanup-phantoms` — delete (unknown) people rows with no
     name, no email, zero meetings (and their dependent rows)
   - `POST /api/admin/clear-queue` — dismiss every pending confirmation_queue item
   - `POST /api/admin/reset-ingest` — clear the Granola high-water mark
4. **MCP**: `curl -X POST $WORKER/mcp -H "Authorization: Bearer $MCP_SECRET" -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`

## Operating the user's deployment

You can edit code and push to GitHub. You **cannot** deploy or read secrets;
the user runs deploys from their Mac because Cloudflare auth and `.secrets/`
live there.

Workflow when you change anything that needs to ship:

1. Edit, typecheck (`npm run typecheck`, `cd pages && npx svelte-check`), commit, push to `main`.
2. Tell the user to run, on their Mac:
   ```
   git pull
   npx wrangler deploy                             # Worker
   (cd pages && npm run build && npx wrangler deploy)   # Pages-as-Worker
   ```
3. Verify with the diagnostic endpoints above.

If you forget step 1 or the user forgets `git pull`, the deployed code will
not include your changes — you can confirm by checking the Worker's
`Current Version ID` after each deploy (it changes on real deploys; staying
the same means nothing was uploaded).

## Conventions

- TypeScript everywhere. Strict mode on. `npm run typecheck` is non-negotiable.
- D1 binds with positional `?N` placeholders. Never string-interpolate user
  data into SQL.
- Tools live as one file each in `src/tools/*.ts` and are registered in
  `src/tools/index.ts`. Both MCP and the web chat consume that registry —
  if you add a tool, both surfaces get it for free.
- The MCP `tools/list` response uses **`inputSchema`** (camelCase). The
  Anthropic API uses **`input_schema`** (snake_case). Don't mix them up; we
  have separate `toMcpTool()` and `toAnthropicTool()` functions for a reason.
- `console.log` and `console.error` are fine in the Worker; they show up in
  `wrangler tail`.
- Don't write feature docs files unless asked — the source plus this folder
  is the documentation. Comments belong only when the *why* is non-obvious.

## Reach for the helper, not the SQL

The codebase had several near-identical SQL blocks copy-pasted across call
sites; these are now shared helpers. Use them, don't re-inline the SQL.

- Loading one person by id → `getPersonById(env, id)` from
  `lib/people_repo.ts`. Replaces `SELECT * FROM people WHERE id = ?1`.
- Creating a person row → `createPerson` from `lib/people_repo.ts`.
- Inserting a meeting → `insertMeeting` from `lib/meetings.ts` (also
  `updateMeetingFromNote`, `findMeetingBySourceRef`,
  `recomputePersonMeetingStats`).
- Inserting a confirmation_queue row → `enqueueConfirmation` from
  `lib/queue.ts` (also `hasPendingForNote`, `setQueueStatus`).
- Loading the "person view" the extractor needs → `loadExtractionContext` /
  `loadExtractionPeerContext` from `lib/extraction_context.ts`.
- Merging two string lists / deduping → `mergeStringArray` / `uniqStrings`
  from `lib/db.ts`.
- Building a `?1,?2,…?N` placeholder string for SQL `IN (…)` clauses →
  `sqlPlaceholders(ids)` from `lib/db.ts`. Pair with `.bind(...ids)`.
- The attendee shape passed through ingest/classify/queue → `AttendeeRef`
  from `lib/db.ts`. Don't re-spell `Array<{email, name}>` inline.
- Wrapping a Hono route so thrown errors become JSON 500s →
  `asJson(...)` from `api/errors.ts`. Hono routes that need to fail in
  one specific way still return `c.json({error}, 4xx)` directly.
- Applying an LLM extraction → `applyExtractionResult` from
  `lib/people_writes.ts`. Don't write the merged-fields UPDATE inline.

The ingest cron's two paths (first-pull vs reprocess-on-edit) both go
through `resolveAttendees`, `runExtractionAndApply`, and `persistMeeting`
in `cron/ingest.ts`. If you change the extraction call shape, change it
once in `runExtractionAndApply`.

## Data protection

Threat model: an AI agent (or the user) misunderstands a request and clobbers
the database via a bad migration, mass mutation, or wrong delete. Not infra
compromise. Two layers, both on Cloudflare, both effectively free:

1. **D1 Time Travel (last 30 days, in-place rollback).** Cloudflare keeps a
   continuous restore log automatically — free on Workers Paid. Restore to
   any second within 30 days:
   ```
   npx wrangler d1 time-travel restore superconnector --timestamp=2026-04-30T14:23:00Z
   ```
   `scripts/deploy.sh` automatically logs the pre-deploy timestamp to
   `backups/restore-points.log` (gitignored, on the user's Mac) so the
   rollback target is exact, not a guess. Run `scripts/restore-point.sh
   "<label>"` manually before any other risky operation (admin endpoints,
   schema migrations).

2. **Worker-side monthly D1 → R2 dump (last 24 months, on Cloudflare).**
   Implemented in `src/cron/backup.ts` (function `runBackup`) and bound to
   the `BACKUPS` R2 bucket in `wrangler.toml`. Cron `0 9 1 * *` (1st of each
   month, 09:00 UTC) writes `superconnector/backups/YYYY-MM-DD.sql` and
   prunes anything older than the 24 most recent. Trigger manually any time
   via `POST /api/run/backup` with the `WEB_AUTH_SECRET`. Total cost:
   ~$0/mo (R2 free tier dwarfs our footprint).

   Restore from any dump:
   ```
   npx wrangler r2 object get superconnector-backups \
     superconnector/backups/2026-04-01.sql --file=/tmp/restore.sql
   npx wrangler d1 execute superconnector --remote --file=/tmp/restore.sql
   ```

**Which layer to use when:**
- "I just dropped a table 10 minutes ago" → Time Travel (1).
- "An agent corrupted half the people rows last week" → Time Travel (1) if
  inside 30 days, else R2 dump (2).
- "I want February's state in November" → R2 dump (2).

## What still hurts and where to look

See `docs/TODOS.md` for the current backlog and `docs/GOTCHAS.md` for the
top of the iceberg of things that have already burned us.
