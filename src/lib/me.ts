// Resolves the "Me" person — the user's own row in the people table — so
// extract / dictation / list / candidate-pool code can all operate on a
// single per-profile marker instead of guessing from email.
//
// Source of truth: `people.degree = 0`. Exactly one row should hold that
// value; if EMAIL_TO matches a row that doesn't yet have it (e.g. a
// deployment from before migration 0011 ran), we promote it lazily so the
// invariant heals on the next call.

import type { Env } from '../../worker-configuration';
import type { PersonRow } from './db';
import { createPerson } from './people_repo';
import { nowIso } from './ulid';

export async function findMePersonId(env: Env): Promise<string | null> {
  const row = await env.DB.prepare(
    'SELECT id FROM people WHERE degree = 0 LIMIT 1',
  ).first<{ id: string }>();
  if (row) return row.id;
  return await healFromEmail(env);
}

export async function findMePerson(env: Env): Promise<PersonRow | null> {
  const row = await env.DB.prepare(
    'SELECT * FROM people WHERE degree = 0 LIMIT 1',
  ).first<PersonRow>();
  if (row) return row;
  const id = await healFromEmail(env);
  if (!id) return null;
  return await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(id).first<PersonRow>();
}

export async function ensureMePerson(env: Env, fallbackName?: string | null): Promise<string | null> {
  const existing = await findMePersonId(env);
  if (existing) return existing;
  const email = (env.EMAIL_TO ?? '').toLowerCase().trim();
  if (!email) return null;
  return await createPerson(env, { email, displayName: fallbackName ?? null, degree: 0 });
}

// Heal an old install: if no row has degree = 0 yet, promote the EMAIL_TO
// row. Idempotent and safe to call from any read path.
async function healFromEmail(env: Env): Promise<string | null> {
  const email = (env.EMAIL_TO ?? '').toLowerCase().trim();
  if (!email) return null;
  const row = await env.DB.prepare(
    'SELECT id FROM people WHERE primary_email = ?1 LIMIT 1',
  ).bind(email).first<{ id: string }>();
  if (!row) return null;
  await env.DB.prepare(
    'UPDATE people SET degree = 0, updated_at = ?1 WHERE id = ?2',
  ).bind(nowIso(), row.id).run();
  return row.id;
}
