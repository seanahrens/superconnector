// Low-level people-table writes shared by `lib/resolve.ts` (creates new
// people during fuzzy resolution) and `lib/me.ts` (cold-start of the
// "Me" row).

import type { Env } from '../../worker-configuration';
import { ulid, nowIso } from './ulid';

export interface CreatePersonOptions {
  email?: string | null;
  displayName?: string | null;
  /** Initial alias list. resolve.ts seeds with the input name; me.ts leaves empty. */
  aliases?: string[];
  /** Connection degree from You: 0 = You (only one row), 1 = direct
   *  (default), 2 = needs intro. me.ts passes 0; everyone else omits. */
  degree?: number;
}

export async function createPerson(env: Env, opts: CreatePersonOptions): Promise<string> {
  const id = ulid();
  const now = nowIso();
  await env.DB.prepare(
    `INSERT INTO people (
       id, primary_email, display_name, aliases, roles, trajectory_tags, status,
       geo, context, needs, offers, last_met_date, follow_up_due_date,
       meeting_count, custom_sort_position, context_manual_override,
       degree,
       created_at, updated_at
     ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)`,
  ).bind(
    id,
    opts.email ?? null,
    opts.displayName ?? null,
    JSON.stringify(opts.aliases ?? []),
    JSON.stringify([]),
    JSON.stringify([]),
    JSON.stringify({}),
    null, null, null, null, null, null,
    0, null, 0,
    opts.degree ?? 1,
    now, now,
  ).run();
  return id;
}
