import type { Env } from '../../worker-configuration';
import type { PersonRow } from './db';
import { nowIso } from './ulid';
import { createPerson } from './people_repo';

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
  const id = await createPerson(env, {
    email,
    displayName: name || null,
    aliases: name ? [name] : [],
  });
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
