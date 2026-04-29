# superconnector

Personal AI-native CRM and matching engine for connecting founders, funders,
talent, and advisors. Runs as a Cloudflare Worker against D1 + Vectorize, with
Granola as the meeting-notes source and Proton Calendar (ICS) as the calendar
feed. Single user.

Architecture and roadmap live in
`/root/.claude/plans/yes-please-create-a-joyful-horizon.md`.

## Status

Phase 1 (skeleton) only. The Worker exposes `GET /health` and registers cron
triggers as no-ops. Ingestion, plays, email, MCP, and the web UI land in later
phases.

## One-time provisioning

```bash
# 1. Install deps
npm install

# 2. Create the D1 database, then paste the returned database_id into
#    wrangler.toml (`[[d1_databases]] database_id = "..."`).
npx wrangler d1 create superconnector

# 3. Create the Vectorize index for person-context embeddings.
npx wrangler vectorize create people-context --dimensions=768 --metric=cosine

# 4. Apply schema migrations (locally, then remote when ready).
npm run db:migrate:local
npm run db:migrate:remote

# 5. Configure secrets.
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put GRANOLA_API_KEY
npx wrangler secret put PROTON_ICS_URL
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_TO
npx wrangler secret put EMAIL_FROM
```

## Local development

```bash
npm run dev          # wrangler dev with local D1
npm run typecheck    # tsc --noEmit
```

Health check: `curl http://localhost:8787/health`

## Deploy

```bash
npm run deploy
```
