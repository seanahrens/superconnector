// Single Cloudflare cron trigger that fans out to many target Workers, so a
// whole account's worth of scheduled jobs only consumes one cron-trigger slot
// (the free-plan limit is 5 across the account).
//
// Add new targets to the SCHEDULE array. Auth secrets per target are
// `wrangler secret put`-style environment variables, named freely; the entry's
// `secret_env_var` field tells the dispatcher which one to attach.

import { Cron } from 'croner';

interface Env {
  ENVIRONMENT: string;
  // Per-target bearer tokens. Add one secret per `secret_env_var` referenced
  // below. Treated as `Record<string, string | undefined>` at runtime so we
  // don't have to keep the type in sync with the schedule.
  [key: string]: unknown;
}

interface ScheduleEntry {
  name: string;                  // human label, shown in logs
  cron: string;                  // cron expression in UTC (5-field unix cron)
  url: string;                   // full URL to POST to when due
  secret_env_var?: string;       // env var holding the bearer token; omitted = no auth
  method?: 'POST' | 'GET';       // default POST
  body?: unknown;                // optional JSON body
  headers?: Record<string, string>;
  enabled?: boolean;             // default true
}

// Schedules in UTC. Cron expressions are matched against the current minute
// inclusive on each tick.
const SCHEDULE: ScheduleEntry[] = [
  // ── superconnector.seanahrens.workers.dev ──────────────────────────────────
  {
    name: 'superconnector:ingest',
    cron: '*/5 * * * *',
    url: 'https://superconnector.seanahrens.workers.dev/api/run/ingest',
    secret_env_var: 'SUPERCONNECTOR_AUTH',
  },
  {
    name: 'superconnector:daily-email',
    cron: '0 13 * * *', // 06:00 PT during PDT
    url: 'https://superconnector.seanahrens.workers.dev/api/run/daily-email',
    secret_env_var: 'SUPERCONNECTOR_AUTH',
  },

  // ── voicebox.seanahrens.workers.dev ────────────────────────────────────────
  // Fill these in once you know voicebox's schedules and endpoints.
  // Example shape:
  // {
  //   name: 'voicebox:something',
  //   cron: '*/10 * * * *',
  //   url: 'https://voicebox.seanahrens.workers.dev/cron/something',
  //   secret_env_var: 'VOICEBOX_AUTH',
  // },
];

export default {
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(dispatch(env, new Date()));
  },

  // Manual trigger for debugging — POST /tick with the right secret to fire.
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json({ status: 'ok', schedule_count: SCHEDULE.filter(enabled).length });
    }
    if (url.pathname === '/tick' && req.method === 'POST') {
      if (!authorizedTick(req, env)) return new Response('unauthorized', { status: 401 });
      const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')!) : new Date();
      const result = await dispatch(env, at);
      return Response.json(result);
    }
    return new Response('cron-hub', { status: 200 });
  },
};

interface DispatchResult {
  fired: Array<{ name: string; status: number | null; error?: string }>;
  skipped: number;
}

async function dispatch(env: Env, now: Date): Promise<DispatchResult> {
  const due = SCHEDULE.filter(enabled).filter((s) => isDueAt(s.cron, now));
  const skipped = SCHEDULE.length - due.length;
  const fired = await Promise.all(due.map((s) => fire(env, s)));
  console.log('cron-hub tick', {
    at: now.toISOString(),
    fired: fired.map((f) => `${f.name} -> ${f.status ?? f.error}`),
    skipped,
  });
  return { fired, skipped };
}

function enabled(s: ScheduleEntry): boolean {
  return s.enabled !== false;
}

function isDueAt(cron: string, now: Date): boolean {
  // croner.nextRun((second before now)) gives the next firing >= now, which
  // equals `now` (to the minute) iff this minute is a match.
  try {
    const c = new Cron(cron, { timezone: 'UTC' });
    const probe = new Date(now.getTime() - 1000);
    const next = c.nextRun(probe);
    if (!next) return false;
    return Math.floor(next.getTime() / 60000) === Math.floor(now.getTime() / 60000);
  } catch (err) {
    console.error('bad cron', { cron, err: (err as Error).message });
    return false;
  }
}

async function fire(
  env: Env,
  s: ScheduleEntry,
): Promise<{ name: string; status: number | null; error?: string }> {
  try {
    const headers = new Headers(s.headers ?? {});
    if (s.secret_env_var) {
      const token = (env as Record<string, unknown>)[s.secret_env_var] as string | undefined;
      if (!token) throw new Error(`missing env secret: ${s.secret_env_var}`);
      headers.set('authorization', `Bearer ${token}`);
    }
    if (s.body !== undefined) headers.set('content-type', 'application/json');
    const resp = await fetch(s.url, {
      method: s.method ?? 'POST',
      headers,
      body: s.body !== undefined ? JSON.stringify(s.body) : undefined,
    });
    return { name: s.name, status: resp.status };
  } catch (err) {
    return { name: s.name, status: null, error: (err as Error).message };
  }
}

function authorizedTick(req: Request, env: Env): boolean {
  const expected = (env as Record<string, unknown>).TICK_SECRET as string | undefined;
  if (!expected) return true; // open in dev
  return req.headers.get('authorization') === `Bearer ${expected}`;
}
