# superconnector

Personal AI-native CRM for connecting founders, funders, talent, and advisors.
Single-user. Runs as a Cloudflare Worker (D1 + Vectorize + Workers AI), pulls
notes from Granola, calendar from Proton ICS, sends a daily email via
Cloudflare Email Workers, and ships with both an MCP server and a SvelteKit
web UI on Cloudflare Pages.

**Working on this repo as an AI agent?** Read `CLAUDE.md`, then
`docs/GOTCHAS.md` and `docs/TODOS.md`. Original architecture spec lives at
`/root/.claude/plans/yes-please-create-a-joyful-horizon.md` for historical
context but the docs are the current source of truth.

## Setup

```bash
npx wrangler login          # one-time, opens a browser
npm run setup               # everything else
```

**Prerequisite for the daily email:** a domain on Cloudflare with **Email Routing** enabled
(dashboard → your domain → Email → Email Routing → enable), and your inbox added as a
**verified destination address** (you'll get a one-click confirmation email). Setup will
still succeed without this — the cron job will just skip sends until you finish those steps.

`npm run setup` is idempotent. It will:

- install both projects' deps,
- create the D1 database and patch its id into `wrangler.toml`,
- create the Vectorize index,
- apply migrations to the remote D1,
- generate `MCP_SECRET` and `WEB_AUTH_SECRET` and push them as Worker secrets,
- prompt for the six secrets only you can supply (links printed below),
- deploy the Worker, capture its URL,
- write `pages/.env` and `pages/wrangler.toml [vars]` with the URL + token,
- build and deploy the SvelteKit Pages app,
- print your MCP config snippet for Claude Desktop.

The six secrets it will prompt for (all skippable on first run; rerun later to fill in):

| secret | where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/settings/keys |
| `GRANOLA_API_KEY` | Granola Business plan API settings |
| `PROTON_ICS_URL` | Proton Calendar > Settings > Calendar > "Share via link" URL |
| `EMAIL_TO` | your inbox (must be a verified destination in Cloudflare Email Routing) |
| `EMAIL_FROM` | any address on a domain you've enabled Email Routing on, e.g. `daily@yourdomain.com` |

Generated secrets are cached in `.secrets/` (gitignored) so the script can
re-use them on repeat runs and so the Pages app gets the same `WEB_AUTH_SECRET`
the Worker is enforcing.

## Layout

```
.
├── src/                        # Cloudflare Worker (API + cron + MCP)
│   ├── index.ts
│   ├── cron/                   # 5-min ingest + 06:00 PT daily email
│   ├── lib/                    # ulid, db, anthropic, ics, granola, embed, …
│   ├── plays/                  # brief, match, ways_to_help, weekly_digest
│   ├── role_packs/             # founder/funder/talent/advisor JSON
│   ├── tools/                  # shared tool registry (used by MCP + chat)
│   ├── mcp/                    # JSON-RPC MCP server
│   └── api/                    # /api/people, /queue, /tags, /followups, /chat, /digest
├── migrations/                 # D1 SQL migrations
├── pages/                      # SvelteKit web UI (Cloudflare Pages-ready)
├── scripts/                    # setup.sh + deploy.sh
└── wrangler.toml
```

## Local development

```bash
npm run dev                                    # wrangler dev :8787
npm run typecheck

# in another shell:
cd pages
npm run dev                                    # vite dev :5173
npm run check
```

Health check: `curl http://localhost:8787/health`

## Re-deploy after changes

```bash
npm run deploy:all
```

(Or individually: `npm run deploy` for the Worker, `cd pages && npm run build && npm run deploy` for the UI.)

## What it does

- **Ingestion** (every 5min): pulls new Granola notes → matches against Proton
  ICS → classifies 1:1/group/ambiguous → resolves person by email/fuzzy name →
  Claude Haiku extracts structured updates (context delta, signals, tag
  proposals, followups) with confidence-gating → re-embeds into Vectorize.
- **Daily email** (06:00 PT): briefs for today's meetings (suggested questions,
  missing-data prompts, open followups, match opportunities), top "ways to
  help" suggestions, due followups. Sundays append a weekly digest section
  (tag proposals, queue depth, stale-active contacts, overdue followups).
- **Plays**: `briefForPerson`, `findMatches` (cofounder/funder/talent/advisor),
  `waysToHelp`, `weeklyDigest`.
- **Tool layer**: 15 tools (search, match, brief, draft intro, tag ops, queue
  ops, followup ops, person mutations, dictate, read-only SQL) shared between
  MCP and the web's master + per-person chats.
- **MCP** at `POST /mcp` (JSON-RPC 2.0, Streamable HTTP transport). Setup
  prints the exact `mcpServers` config snippet to drop into Claude Desktop.
- **Web UI**: two-pane shell, people list with tag/role filters and four sort
  modes (recent, frequent, magical, drag-and-drop custom), profile with
  pinned per-person chat, ⌘K master chat drawer, queue/tags/followups
  review screens.

## Production access control

Two layers, both required:

1. **Pages worker (`superconnector-pages`)** is gated by HTTP Basic Auth in
   `pages/src/hooks.server.ts`. The browser will prompt for credentials on
   first visit. Username can be anything; the password is `WEB_AUTH_SECRET`.
   If `WEB_AUTH_SECRET` is unset on the Pages worker, every request fails
   with 503 (fail closed by design).
2. **Worker API (`superconnector`)** is gated by `Authorization: Bearer
   <WEB_AUTH_SECRET>`. Browser traffic does NOT call the Worker directly —
   `pages/src/routes/api/[...path]/+server.ts` is a same-origin server-side
   proxy that attaches the bearer for you, and dispatches to the Worker via
   a **service binding** declared in `pages/wrangler.toml` (`[[services]]`,
   binding `WORKER_API`, service `superconnector`). The token never leaves
   the Pages worker. MCP clients (claude-desktop) supply the token directly.

   **Why a service binding and not an HTTP fetch on `*.workers.dev`?** When
   one Worker tries to fetch another Worker on the same account via the
   public `*.workers.dev` hostname, Cloudflare returns its generic 404
   placeholder ("There is nothing here yet"). Service bindings dispatch
   directly through the platform and bypass that.

Required Pages-worker secret (set with `npx wrangler secret put` in the
`pages/` directory):

| secret | value |
|---|---|
| `WEB_AUTH_SECRET` | same string as the Worker (also used for basic auth) |

The Worker URL itself is no longer needed as a secret — the service binding
in `pages/wrangler.toml` handles dispatch by service name. The old
`PUBLIC_API_TOKEN` / `PUBLIC_API_BASE` / `WORKER_API_BASE` vars are gone —
they leaked the bearer or are obsolete. If you're running an older
deployment, rotate `WEB_AUTH_SECRET` after upgrading.

For zero-trust style edge auth, `Cloudflare Access` (free, ≤50 users) can sit
in front of both Workers. See `docs/TODOS.md` for the dashboard-config steps.
