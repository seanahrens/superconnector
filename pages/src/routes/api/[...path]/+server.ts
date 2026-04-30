// Server-side proxy: forwards every /api/* request from the SvelteKit app to
// the Worker API, attaching the bearer token from PRIVATE env. The browser
// never sees the token. hooks.server.ts already gated the request, so anyone
// reaching here has supplied the basic-auth password.

import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'content-encoding',
  'content-length',
]);

async function proxy({ request, params, url }: Parameters<RequestHandler>[0]): Promise<Response> {
  const base = (env.WORKER_API_BASE ?? '').replace(/\/$/, '');
  const secret = env.WEB_AUTH_SECRET;
  if (!base || !secret) {
    const missing = [!base && 'WORKER_API_BASE', !secret && 'WEB_AUTH_SECRET']
      .filter(Boolean)
      .join(', ');
    console.error(
      `pages api proxy: missing required private env var(s): ${missing}. ` +
        `Push with: cd pages && npx wrangler secret put <NAME>`,
    );
    return new Response(
      JSON.stringify({
        error: `Pages worker misconfigured: missing ${missing}. ` +
          `Run \`cd pages && npx wrangler secret put ${missing.split(', ')[0]}\` and redeploy.`,
      }),
      { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }

  const path = (params as { path?: string }).path ?? '';
  const target = `${base}/api/${path}${url.search}`;

  const headers = new Headers();
  for (const [k, v] of request.headers) {
    const lk = k.toLowerCase();
    if (lk === 'authorization' || lk === 'host' || HOP_BY_HOP.has(lk)) continue;
    headers.set(k, v);
  }
  headers.set('authorization', `Bearer ${secret}`);

  const init: RequestInit = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    // @ts-expect-error - duplex required when streaming a request body
    init.duplex = 'half';
  }

  const upstream = await fetch(target, init);

  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    respHeaders.set(k, v);
  }
  respHeaders.set('cache-control', 'no-store');

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: respHeaders,
  });
}

export const GET: RequestHandler = (e) => proxy(e);
export const POST: RequestHandler = (e) => proxy(e);
export const PATCH: RequestHandler = (e) => proxy(e);
export const PUT: RequestHandler = (e) => proxy(e);
export const DELETE: RequestHandler = (e) => proxy(e);
export const OPTIONS: RequestHandler = (e) => proxy(e);
