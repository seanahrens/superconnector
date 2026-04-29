import { Hono } from 'hono';
import type { Env } from '../worker-configuration';
import { runIngest } from './cron/ingest';
import { runDailyEmail } from './cron/daily_email';

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
