// Single-user auth: a shared secret in the `Authorization: Bearer <secret>`
// header (set by the SvelteKit app from a secure cookie). When WEB_AUTH_SECRET
// is unset (local dev), auth is bypassed.

import type { MiddlewareHandler } from 'hono';
import type { Env } from '../../worker-configuration';

export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const secret = c.env.WEB_AUTH_SECRET;
  if (!secret) return next();
  const got = c.req.header('authorization') ?? '';
  if (got !== `Bearer ${secret}`) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  return next();
};
