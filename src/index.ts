import { Hono } from 'hono';
import type { Env } from '../worker-configuration';

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

  async scheduled(event: ScheduledController, _env: Env, ctx: ExecutionContext): Promise<void> {
    // Cron dispatch — implementations land in Phase 2 (ingest) and Phase 3 (daily email).
    ctx.waitUntil(handleScheduled(event));
  },
} satisfies ExportedHandler<Env>;

async function handleScheduled(event: ScheduledController): Promise<void> {
  const cron = event.cron;
  if (cron === '*/5 * * * *') {
    // TODO(phase-2): pull new Granola notes and run the ingestion pipeline.
    return;
  }
  if (cron === '0 13 * * *') {
    // TODO(phase-3): assemble and send the daily email.
    return;
  }
}
