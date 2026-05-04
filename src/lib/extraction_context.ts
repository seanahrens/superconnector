// Helpers for loading the "person-shaped context" the extraction LLM needs
// (display_name + free-text fields + roles/trajectory tags as arrays).
// Inlined in three call sites (ingest.processNote, ingest.reprocessNote,
// queue_resolve.materialize) before being centralized here.

import type { Env } from '../../worker-configuration';
import type { PersonRow } from './db';
import { parseJsonArray } from './db';
import type { ExtractInput } from './extract';
import { findMePerson } from './me';

type ExtractionPerson = NonNullable<ExtractInput['existingPerson']>;

export function personRowToExtractionContext(p: PersonRow | null | undefined): ExtractionPerson | undefined {
  if (!p) return undefined;
  return {
    displayName: p.display_name,
    context: p.context,
    needs: p.needs,
    offers: p.offers,
    roles: parseJsonArray(p.roles),
    trajectoryTags: parseJsonArray(p.trajectory_tags),
  };
}

export async function loadExtractionContext(
  env: Env,
  personId: string,
): Promise<ExtractionPerson | undefined> {
  const row = await env.DB.prepare(
    `SELECT display_name, context, needs, offers, roles, trajectory_tags
     FROM people WHERE id = ?1`,
  ).bind(personId).first<Pick<PersonRow,
    'display_name' | 'context' | 'needs' | 'offers' | 'roles' | 'trajectory_tags'
  >>();
  if (!row) return undefined;
  return {
    displayName: row.display_name,
    context: row.context,
    needs: row.needs,
    offers: row.offers,
    roles: parseJsonArray(row.roles),
    trajectoryTags: parseJsonArray(row.trajectory_tags),
  };
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
  return {
    existingPerson: await loadExtractionContext(env, counterpartId),
    userPerson: personRowToExtractionContext(me),
    mePersonId: me?.id ?? null,
  };
}
