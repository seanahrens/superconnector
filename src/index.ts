import { Hono } from 'hono';
import type { Env } from '../worker-configuration';
import { runIngest } from './cron/ingest';
import { runDailyEmail } from './cron/daily_email';
import { handleMcp } from './mcp/server';
import { requireAuth } from './api/auth';
import people from './api/people';
import queue from './api/queue';
import tags from './api/tags';
import followups from './api/followups';
import chat from './api/chat';
import digest from './api/digest';

const app = new Hono<{ Bindings: Env }>();

app.get('/health', async (c) => {
  const dbReachable = await pingDb(c.env);
  return c.json({
    status: dbReachable ? 'ok' : 'degraded',
    environment: c.env.ENVIRONMENT,
    db: dbReachable ? 'reachable' : 'unreachable',
    time: new Date().toISOString(),
  });
});

app.get('/', (c) => c.text('superconnector'));

// MCP endpoint — its own auth header (MCP_SECRET).
app.all('/mcp', async (c) => handleMcp(c.env, c.req.raw));

// Web API — auth-gated. The SvelteKit Pages worker proxies all browser traffic
// server-to-server, so we don't expose any CORS allowance here. Direct browser
// calls from third-party origins are rejected by the same-origin policy.
app.use('/api/*', requireAuth);
app.route('/api/people', people);
app.route('/api/queue', queue);
app.route('/api/tags', tags);
app.route('/api/followups', followups);
app.route('/api/chat', chat);
app.route('/api/digest', digest);

// Manual triggers (auth-gated) for testing the cron paths.
app.post('/api/run/ingest', requireAuth, async (c) => {
  try {
    const result = await runIngest(c.env);
    return c.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('ingest failed', message);
    return c.json({ error: message }, 500);
  }
});

app.post('/api/run/daily-email', requireAuth, async (c) => {
  try {
    await runDailyEmail(c.env);
    return c.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('daily-email failed', message);
    return c.json({ error: message }, 500);
  }
});

// Admin: clean up phantom (unknown) people created before ingest hardening.
// People with no email, no name, and zero meetings are pure noise — delete them
// and any tags/signals/followups that referenced them.
app.post('/api/admin/cleanup-phantoms', requireAuth, async (c) => {
  const phantoms = await c.env.DB.prepare(
    `SELECT id FROM people
     WHERE (display_name IS NULL OR display_name = '')
       AND (primary_email IS NULL OR primary_email = '')
       AND meeting_count = 0`,
  ).all<{ id: string }>();
  const ids = (phantoms.results ?? []).map((r) => r.id);
  for (const id of ids) {
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM person_tags WHERE person_id = ?1').bind(id),
      c.env.DB.prepare('DELETE FROM signals WHERE person_id = ?1').bind(id),
      c.env.DB.prepare('DELETE FROM followups WHERE person_id = ?1').bind(id),
      c.env.DB.prepare('DELETE FROM people WHERE id = ?1').bind(id),
    ]);
  }
  return c.json({ deleted: ids.length });
});

// Admin: dismiss every pending queue item. Use after a logic change makes the
// existing pending items stale.
app.post('/api/admin/clear-queue', requireAuth, async (c) => {
  const r = await c.env.DB.prepare(
    `UPDATE confirmation_queue SET status = 'dismissed' WHERE status = 'pending'`,
  ).run();
  return c.json({ dismissed: r.meta.changes ?? 0 });
});

// Admin: reset the Granola high-water mark so the next ingest re-pulls notes.
// Existing meetings are kept; getExistingMeeting() skips them by source_ref
// unless the note's content hash has changed (which then triggers reprocess).
app.post('/api/admin/reset-ingest', requireAuth, async (c) => {
  await c.env.DB.prepare(`DELETE FROM ingest_state WHERE source = 'granola'`).run();
  return c.json({ ok: true });
});

// Admin: force a Granola sweep starting at `since` (ISO 8601). Use this after
// editing a batch of note titles in Granola — it ignores the high-water mark
// for one run, so every note >= since is checked for content changes and
// reprocessed in place. Cheaper than nuking the high-water mark.
app.post('/api/admin/repull-granola', requireAuth, async (c) => {
  const url = new URL(c.req.url);
  const since = url.searchParams.get('since') ?? '1970-01-01T00:00:00Z';
  try {
    const result = await runIngest(c.env, { forceSince: since });
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Diagnostic: test Granola API connectivity and show raw response shape.
app.get('/api/run/check-granola', requireAuth, async (c) => {
  const key = c.env.GRANOLA_API_KEY;
  if (!key) return c.json({ error: 'GRANOLA_API_KEY not set' }, 500);
  try {
    const url = 'https://public-api.granola.ai/v1/notes';
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    const text = await resp.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = text; }
    return c.json({ status: resp.status, url, body: parsed });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

async function pingDb(env: Env): Promise<boolean> {
  try {
    const result = await env.DB.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return result?.ok === 1;
  } catch {
    return false;
  }
}

export default {
  fetch: app.fetch,

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(handleScheduled(event, env));
  },
} satisfies ExportedHandler<Env>;

async function handleScheduled(event: ScheduledController, env: Env): Promise<void> {
  const cron = event.cron;
  if (cron === '*/5 * * * *') {
    const result = await runIngest(env);
    console.log('ingest', result);
    return;
  }
  if (cron === '0 13 * * *') {
    await runDailyEmail(env);
    return;
  }
}
