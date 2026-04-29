# cron-hub

A single Cloudflare Worker with one cron trigger (`* * * * *`) that fans out
to many target Workers' HTTP endpoints. Lets you run any number of scheduled
jobs across an account while only consuming one of the free plan's five
cron-trigger slots.

Schedule entries live in `src/index.ts`. Edit the `SCHEDULE` array and
`npm run deploy` to update.

## Setup

```bash
npm install
npx wrangler deploy
```

Then per target Worker, add its bearer token as a secret on the hub:

```bash
echo -n "$SUPERCONNECTOR_WEB_AUTH_SECRET" | npx wrangler secret put SUPERCONNECTOR_AUTH
echo -n "$VOICEBOX_AUTH_TOKEN"             | npx wrangler secret put VOICEBOX_AUTH
```

The env-var name (`SUPERCONNECTOR_AUTH` etc.) is whatever you reference in
your schedule entry's `secret_env_var`.

## Migrating an existing Worker into the hub

1. Add an entry for it in `src/index.ts`'s `SCHEDULE` array (URL + cron + auth).
2. Push the auth secret to the hub: `wrangler secret put <NAME>`.
3. Deploy the hub: `npx wrangler deploy`.
4. Verify via the manual tick endpoint (see Debugging below).
5. In the source Worker's `wrangler.toml`, remove the `[triggers]` block.
6. Redeploy the source Worker — the cron slot frees up immediately.

## Debugging

```bash
# Health check
curl https://cron-hub.<account>.workers.dev/health

# Force a tick "now" without waiting for the cron
curl -X POST -H "Authorization: Bearer $TICK_SECRET" \
     https://cron-hub.<account>.workers.dev/tick

# Force a tick for a specific UTC time (test a daily-email schedule today)
curl -X POST -H "Authorization: Bearer $TICK_SECRET" \
     "https://cron-hub.<account>.workers.dev/tick?at=2026-04-30T13:00:00Z"
```

`TICK_SECRET` is optional. Set it for any production use:

```bash
echo -n "$(node -e "process.stdout.write(require('crypto').randomBytes(24).toString('base64url'))")" \
  | npx wrangler secret put TICK_SECRET
```

## Cost

Free tier: 100k Worker requests/day. The hub itself uses 1440/day (one per
minute). Each fired target uses one outbound subrequest. Order-of-magnitude
1500-2000 requests/day total — well under the limit.
