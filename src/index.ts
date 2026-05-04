// Worker entrypoint. Mounts the public surface (health, mcp), the auth-
// gated /api/* routes, the manual cron triggers, and the scheduled handler.

import { Hono } from 'hono';
import type { Env } from '../worker-configuration';
import { runIngest } from './cron/ingest';
import { runDailyEmail } from './cron/daily_email';
import { runBackup } from './cron/backup';
import { handleMcp } from './mcp/server';
import { requireAuth } from './api/auth';
import { asJson } from './api/errors';
import people from './api/people';
import queue from './api/queue';
import tags from './api/tags';
import followups from './api/followups';
import chat from './api/chat';
import digest from './api/digest';
import notes from './api/notes';
import admin from './api/admin';
import diagnostics from './api/diagnostics';

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
app.route('/api/notes', notes);
app.route('/api/admin', admin);
app.route('/api/run', diagnostics);

// Manual triggers (auth-gated) for testing the cron paths.
app.post('/api/run/ingest', asJson<{ Bindings: Env }>(async (c) => {
  const result = await runIngest(c.env);
  return c.json(result);
}, 'ingest'));

// Manual trigger for the monthly D1 → R2 backup.
app.post('/api/run/backup', asJson<{ Bindings: Env }>(async (c) => {
  const result = await runBackup(c.env);
  return c.json(result);
}, 'backup'));

app.post('/api/run/daily-email', asJson<{ Bindings: Env }>(async (c) => {
  await runDailyEmail(c.env);
  return c.json({ ok: true });
}, 'daily-email'));

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
  if (cron === '0 9 1 * *') {
    const result = await runBackup(env);
    console.log('backup', result);
    return;
  }
}
