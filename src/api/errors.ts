// Common JSON error helpers for Hono routes. Lifts the boilerplate
// `try { ... } catch (err) { return c.json({ error: ... }, 500) }` blocks
// that wrapped most route handlers.

import type { Context, Env, Handler } from 'hono';

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Wraps an async route handler so any thrown error becomes a JSON 500.
// Lets handlers `throw` on failure instead of repeating try/catch in every
// route.
export function asJson<E extends Env>(
  fn: (c: Context<E>) => Promise<Response>,
  label?: string,
): Handler<E> {
  return async (c) => {
    try {
      return await fn(c as Context<E>);
    } catch (err) {
      const msg = errorMessage(err);
      if (label) console.error(`${label} failed`, msg);
      return c.json({ error: msg }, 500) as unknown as Response;
    }
  };
}
