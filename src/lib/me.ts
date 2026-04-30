// Resolves the "Me" person — the user's own row in the people table —
// so extract / dictation pipelines can apply self-statements (everything
// the [microphone] speaker says about themselves) to the right record.
//
// "Me" is identified by env.EMAIL_TO matching `primary_email`. If no row
// exists yet (cold start), one is created lazily with the EMAIL_TO email
// and the owner name from Granola when available.

import type { Env } from '../../worker-configuration';
import type { PersonRow } from './db';
import { ulid, nowIso } from './ulid';

export async function findMePersonId(env: Env): Promise<string | null> {
  const email = (env.EMAIL_TO ?? '').toLowerCase().trim();
  if (!email) return null;
  const row = await env.DB.prepare(
    'SELECT id FROM people WHERE primary_email = ?1 LIMIT 1',
  ).bind(email).first<{ id: string }>();
  return row?.id ?? null;
}

export async function findMePerson(env: Env): Promise<PersonRow | null> {
  const email = (env.EMAIL_TO ?? '').toLowerCase().trim();
  if (!email) return null;
  return await env.DB.prepare(
    'SELECT * FROM people WHERE primary_email = ?1 LIMIT 1',
  ).bind(email).first<PersonRow>();
}

export async function ensureMePerson(env: Env, fallbackName?: string | null): Promise<string | null> {
  const email = (env.EMAIL_TO ?? '').toLowerCase().trim();
  if (!email) return null;
  const existing = await findMePersonId(env);
  if (existing) return existing;
  const id = ulid();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO people (
       id, primary_email, display_name, aliases, roles, trajectory_tags, status,
       geo, context, needs, offers, last_met_date, follow_up_due_date,
       meeting_count, custom_sort_position, context_manual_override,
       created_at, updated_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18)`,
  ).bind(
    id,
    email,
    fallbackName ?? null,
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify({}),
    null, null, null, null, null, null,
    0, null, 0,
    now, now,
  ).run();
  return id;
}
