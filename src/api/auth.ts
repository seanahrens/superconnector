// Single-user auth: a shared secret in the `Authorization: Bearer <secret>`
// header. The SvelteKit Pages worker proxies browser traffic and attaches this
// header server-side; MCP clients (claude-desktop) supply it directly.
//
// When ENVIRONMENT === 'development' AND WEB_AUTH_SECRET is unset, auth is
// bypassed for local dev convenience. In any other case (incl. prod with the
// secret missing) we fail CLOSED — better to break the deployment than to
// silently expose data.

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../worker-configuration';

export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const secret = c.env.WEB_AUTH_SECRET;
  const isDev = c.env.ENVIRONMENT === 'development';

  if (!secret) {
    if (isDev) return next();
    console.error('requireAuth: WEB_AUTH_SECRET unset in non-dev environment — refusing request');
    return c.json({ error: 'server misconfigured' }, 503);
  }

  const got = c.req.header('authorization') ?? '';
  if (got !== `Bearer ${secret}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
};
