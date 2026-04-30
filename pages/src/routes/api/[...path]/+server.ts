// Server-side proxy: forwards every /api/* request from the SvelteKit app to
// the Worker API, attaching the bearer token from PRIVATE env. The browser
// never sees the token. hooks.server.ts already gated the request, so anyone
// reaching here has supplied the basic-auth password.

import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';

// The Worker API service binding (declared in wrangler.toml). Bypasses the
// public workers.dev hostname, which returns Cloudflare's 404 placeholder for
// worker-to-worker subrequests.
interface ServiceBinding {
  fetch: typeof fetch;
}

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

async function proxy({ request, params, url, platform }: Parameters<RequestHandler>[0]): Promise<Response> {
  const secret = env.WEB_AUTH_SECRET;
  const binding = (platform?.env as { WORKER_API?: ServiceBinding } | undefined)?.WORKER_API;
  if (!binding || !secret) {
    const missing = [!binding && 'WORKER_API service binding', !secret && 'WEB_AUTH_SECRET']
      .filter(Boolean)
      .join(', ');
    console.error(`pages api proxy: missing ${missing}`);
    return new Response(
      JSON.stringify({ error: `Pages worker misconfigured: missing ${missing}.` }),
      { status: 503, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    );
  }

  const path = (params as { path?: string }).path ?? '';
  // Service-binding fetch still needs a URL; the host is ignored by the
  // platform but must be syntactically valid.
  const target = `https://worker-api.internal/api/${path}${url.search}`;

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

  let upstream: Response;
  try {
    upstream = await binding.fetch(target, init);
  } catch (err) {
    console.error('proxy: service binding fetch failed', (err as Error).message);
    return new Response(JSON.stringify({ error: `proxy fetch failed: ${(err as Error).message}` }), {
      status: 502,
      headers: { 'content-type': 'application/json' },
    });
  }

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
