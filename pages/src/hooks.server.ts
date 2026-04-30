// Basic-auth gate for the entire Pages site, plus a same-origin proxy to the
// Worker API. The previous setup leaked the API bearer token to the public
// (PUBLIC_API_TOKEN was bundled into client JS). This file makes sure:
//   1. No page renders without HTTP basic auth (browsers prompt natively).
//   2. The Worker API token never travels to the client — only the SvelteKit
//      server-side proxy at /api/* knows it.
//
// Required private env vars on the Pages worker (set with `wrangler secret put`):
//   WEB_AUTH_SECRET   — the same secret the Worker API checks. Used here as
//                       the basic-auth password and forwarded as Bearer to
//                       the Worker API. Username is unused; any value works.
//   WORKER_API_BASE   — full URL of the Worker (e.g. https://superconnector.<acct>.workers.dev).
//
// PUBLIC_API_BASE / PUBLIC_API_TOKEN are intentionally NOT used anymore.

import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const REALM = 'superconnector';

function unauthorized(): Response {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'cache-control': 'no-store',
    },
  });
}

function checkBasic(headerValue: string | null, password: string): boolean {
  if (!headerValue || !headerValue.toLowerCase().startsWith('basic ')) return false;
  let decoded: string;
  try {
    decoded = atob(headerValue.slice(6).trim());
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx < 0) return false;
  const supplied = decoded.slice(idx + 1);
  return constantTimeEq(supplied, password);
}

function constantTimeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const handle: Handle = async ({ event, resolve }) => {
  const password = env.WEB_AUTH_SECRET;
  // If WEB_AUTH_SECRET is unset on the Pages worker, fail closed — refuse to
  // serve anything rather than silently going public. This matches the
  // expectation that the deployed app is always gated.
  if (!password) {
    return new Response('WEB_AUTH_SECRET not configured on Pages worker.', {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }

  if (!checkBasic(event.request.headers.get('authorization'), password)) {
    return unauthorized();
  }

  const response = await resolve(event);
  // Do not let any auth-gated response be cached by intermediaries.
  response.headers.set('cache-control', 'no-store');
  return response;
};
