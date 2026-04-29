# superconnector

Personal AI-native CRM for connecting founders, funders, talent, and advisors.
Single-user. Runs as a Cloudflare Worker (D1 + Vectorize + Workers AI), pulls
notes from Granola, calendar from Proton ICS, sends a daily email via Resend,
and ships with both an MCP server and a SvelteKit web UI on Cloudflare Pages.

Architecture in `/root/.claude/plans/yes-please-create-a-joyful-horizon.md`.

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
└── wrangler.toml
```

## One-time provisioning

```bash
# Worker side
npm install
npx wrangler d1 create superconnector
# → paste database_id into wrangler.toml
npx wrangler vectorize create people-context --dimensions=768 --metric=cosine
npm run db:migrate:remote                      # apply migrations to remote D1
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GRANOLA_API_KEY
npx wrangler secret put PROTON_ICS_URL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_TO
npx wrangler secret put EMAIL_FROM
npx wrangler secret put MCP_SECRET             # bearer for /mcp
npx wrangler secret put WEB_AUTH_SECRET        # bearer for /api/*

# UI side
cd pages
npm install
cp .env.example .env
# → set PUBLIC_API_BASE to your Worker URL and PUBLIC_API_TOKEN to WEB_AUTH_SECRET
```

## Local development

```bash
# Worker
npm run dev                                    # wrangler dev :8787
npm run typecheck

# UI (in another shell)
cd pages
npm run dev                                    # vite dev :5173
npm run check
```

Health check: `curl http://localhost:8787/health`

## Deploy

```bash
npm run deploy                                 # Worker → workers.dev
cd pages && npm run build && npm run deploy    # SvelteKit → pages.dev
```

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
  `waysToHelp`, `weeklyDigest`. Each = prompt + query pattern; trivially
  extensible.
- **Tool layer**: 15 tools (search_people, find_matches, brief_for, draft_intro,
  apply/remove tag, review_tag_proposal, add/update_person, dictate, queue
  ops, followup ops, query_db_readonly) shared between MCP and the web's
  master + per-person chats.
- **MCP** at `POST /mcp` (JSON-RPC 2.0, Streamable HTTP transport). Add to
  Claude Desktop with bearer token = `MCP_SECRET`.
- **Web UI**: two-pane shell, people list with tag/role filters and four sort
  modes (recent, frequent, magical, drag-and-drop custom), profile with
  pinned per-person chat, ⌘K master chat drawer, queue/tags/followups
  review screens.

## Connecting Claude Desktop to the MCP server

Claude Desktop's MCP support is stdio-based; bridge to the HTTP endpoint with
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote):

```jsonc
{
  "mcpServers": {
    "superconnector": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://<worker-host>/mcp",
        "--header", "Authorization:Bearer <MCP_SECRET>"
      ]
    }
  }
}
```
