import { Hono } from 'hono';
import { cors } from 'hono/cors';
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

// Web API — CORS for the SvelteKit Pages app, then auth-gated.
app.use(
  '/api/*',
  cors({
    origin: (origin) => origin ?? '*',
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['authorization', 'content-type'],
  }),
);
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
