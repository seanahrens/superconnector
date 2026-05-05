// Helpers for loading the "person-shaped context" the extraction LLM needs
// (display_name + free-text fields + roles/trajectory tags as arrays + the
// person's currently-live wants so the LLM can flag echoes/supersession
// instead of inserting duplicate signal rows).

import type { Env } from '../../worker-configuration';
import type { PersonRow } from './db';
import { parseJsonArray } from './db';
import type { ExtractInput } from './extract';
import { findMePerson } from './me';
import { loadActiveWants } from './wants';

type ExtractionPerson = NonNullable<ExtractInput['existingPerson']>;

export function personRowToExtractionContext(p: PersonRow | null | undefined): ExtractionPerson | undefined {
  if (!p) return undefined;
  return {
    displayName: p.display_name,
    context: p.context,
    wants: p.wants,
    roles: parseJsonArray(p.roles),
    trajectoryTags: parseJsonArray(p.trajectory_tags),
  };
}

async function attachLiveWants(
  env: Env,
  ctx: ExtractionPerson | undefined,
  personId: string,
): Promise<ExtractionPerson | undefined> {
  if (!ctx) return ctx;
  const live = await loadActiveWants(env, personId, 30);
  ctx.liveWants = live.map((w) => ({
    id: w.id,
    body: w.body,
    last_validated_at: w.last_validated_at,
  }));
  return ctx;
}

export async function loadExtractionContext(
  env: Env,
  personId: string,
): Promise<ExtractionPerson | undefined> {
  const row = await env.DB.prepare(
    `SELECT display_name, context, wants, roles, trajectory_tags
     FROM people WHERE id = ?1`,
  ).bind(personId).first<Pick<PersonRow,
    'display_name' | 'context' | 'wants' | 'roles' | 'trajectory_tags'
  >>();
  if (!row) return undefined;
  const base: ExtractionPerson = {
    displayName: row.display_name,
    context: row.context,
    wants: row.wants,
    roles: parseJsonArray(row.roles),
    trajectoryTags: parseJsonArray(row.trajectory_tags),
  };
  return await attachLiveWants(env, base, personId);
}

// Shape that callers need before invoking extractFromMeeting +
// applyExtractionResult: the counterpart's view, the user's view (if any),
// and the user's id so self-statements can be applied.
export interface ExtractionPeerContext {
  existingPerson: ExtractionPerson | undefined;
  userPerson: ExtractionPerson | undefined;
  mePersonId: string | null;
}

export async function loadExtractionPeerContext(
  env: Env,
  counterpartId: string,
): Promise<ExtractionPeerContext> {
  const me = await findMePerson(env);
  const userPerson = personRowToExtractionContext(me);
  return {
    existingPerson: await loadExtractionContext(env, counterpartId),
    userPerson: me ? await attachLiveWants(env, userPerson, me.id) : undefined,
    mePersonId: me?.id ?? null,
  };
}
