// Resolves the "Me" person — the user's own row in the people table —
// so extract / dictation pipelines can apply self-statements (everything
// the [microphone] speaker says about themselves) to the right record.
//
// "Me" is identified by env.EMAIL_TO matching `primary_email`. If no row
// exists yet (cold start), one is created lazily with the EMAIL_TO email
// and the owner name from Granola when available.

import type { Env } from '../../worker-configuration';
import type { PersonRow } from './db';
import { createPerson } from './people_repo';

function meEmail(env: Env): string | null {
  const email = (env.EMAIL_TO ?? '').toLowerCase().trim();
  return email || null;
}

export async function findMePerson(env: Env): Promise<PersonRow | null> {
  const email = meEmail(env);
  if (!email) return null;
  return await env.DB.prepare(
    'SELECT * FROM people WHERE primary_email = ?1 LIMIT 1',
  ).bind(email).first<PersonRow>();
}

export async function ensureMePerson(env: Env, fallbackName?: string | null): Promise<string | null> {
  const email = meEmail(env);
  if (!email) return null;
  const existing = await findMePerson(env);
  if (existing) return existing.id;
  return await createPerson(env, { email, displayName: fallbackName ?? null });
}
