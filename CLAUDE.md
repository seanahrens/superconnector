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
  cron/                 ingest.ts, daily_email.ts
  lib/                  granola, ics, classify, resolve, extract, anthropic, embed, email, …
  plays/                brief, match_*, ways_to_help, weekly_digest
  role_packs/           founder/funder/talent/advisor JSON
  tools/                15 tools shared by MCP + web chat — single registry in tools/index.ts
  mcp/                  JSON-RPC server (one file)
  api/                  Hono routes mounted under /api/*
migrations/             D1 SQL migrations
pages/                  SvelteKit app, deploys as superconnector-pages worker
scripts/setup.sh        Idempotent one-shot provisioner — read this before changing infra
cron-hub/               Standalone Worker; multi-project cron fan-out (not currently active)
docs/                   GOTCHAS.md, TODOS.md
```

## Auth model (post 2026-04-29)

- **Pages worker** is gated by HTTP Basic Auth in `pages/src/hooks.server.ts`.
  Browser prompts natively. Password = `WEB_AUTH_SECRET` (any username).
  Fails CLOSED with 503 if the secret is unset.
- **Browser → API** flows through a same-origin server-side proxy at
  `pages/src/routes/api/[...path]/+server.ts`. It attaches
  `Authorization: Bearer <WEB_AUTH_SECRET>` from `$env/dynamic/private`
  (vars `WEB_AUTH_SECRET`, `WORKER_API_BASE`). The bearer never reaches the
  client. The old `PUBLIC_API_TOKEN` is gone — do not reintroduce it.
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

## What still hurts and where to look

See `docs/TODOS.md` for the current backlog and `docs/GOTCHAS.md` for the
top of the iceberg of things that have already burned us.
