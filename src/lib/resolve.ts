import type { Env } from '../../worker-configuration';
import type { PersonRow } from './db';
import { ulid, nowIso } from './ulid';

export interface ResolveCandidate {
  email?: string | null;
  name?: string | null;
}

export interface ResolveResult {
  personId: string;
  created: boolean;
  ambiguous: boolean;          // true if we had to pick between fuzzy matches
  candidatesIfAmbiguous?: PersonRow[];
}

export async function resolvePerson(env: Env, c: ResolveCandidate): Promise<ResolveResult> {
  // 1) Email exact match.
  const email = c.email?.toLowerCase().trim() || null;
  if (email) {
    const found = await env.DB.prepare(
      'SELECT * FROM people WHERE primary_email = ?1 LIMIT 1',
    ).bind(email).first<PersonRow>();
    if (found) return { personId: found.id, created: false, ambiguous: false };
  }

  // 2) Fuzzy name match (no email-bound row).
  const name = (c.name ?? '').trim();
  if (name) {
    const matches = await fuzzyByName(env, name);
    if (matches.length === 1) {
      // Auto-attach email if we have one and the row didn't.
      if (email && !matches[0]!.primary_email) {
        await env.DB.prepare(
          'UPDATE people SET primary_email = ?1, updated_at = ?2 WHERE id = ?3',
        ).bind(email, nowIso(), matches[0]!.id).run();
      }
      return { personId: matches[0]!.id, created: false, ambiguous: false };
    }
    if (matches.length > 1) {
      return {
        personId: '',
        created: false,
        ambiguous: true,
        candidatesIfAmbiguous: matches,
      };
    }
  }

  // 3) Create new person.
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
    name || null,
    JSON.stringify(name ? [name] : []),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify({}),
    null,
    null,
    null,
    null,
    null,
    null,
    0,
    null,
    0,
    now,
    now,
  ).run();
  return { personId: id, created: true, ambiguous: false };
}

async function fuzzyByName(env: Env, name: string): Promise<PersonRow[]> {
  // Cheap fuzzy: exact (case-insensitive) match on display_name first, then
  // LIKE on a normalized form. Single-user scale keeps this fine.
  const norm = name.toLowerCase();
  const exact = await env.DB.prepare(
    'SELECT * FROM people WHERE LOWER(display_name) = ?1 LIMIT 5',
  ).bind(norm).all<PersonRow>();
  if ((exact.results ?? []).length > 0) return exact.results!;

  const first = norm.split(/\s+/)[0] ?? norm;
  const last = norm.split(/\s+/).slice(-1)[0] ?? '';
  const likeFirst = `%${first}%`;
  const likeLast = `%${last}%`;
  const partial = await env.DB.prepare(
    `SELECT * FROM people
     WHERE LOWER(display_name) LIKE ?1
        OR LOWER(display_name) LIKE ?2
        OR LOWER(COALESCE(aliases, '')) LIKE ?1
     LIMIT 10`,
  ).bind(likeFirst, likeLast).all<PersonRow>();
  return partial.results ?? [];
}
