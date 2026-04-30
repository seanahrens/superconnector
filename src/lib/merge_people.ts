// Merge-people primitives (TODO I).
//
// Two responsibilities:
//   1. Rank merge candidates from the people table for a given target,
//      using cheap regex/string heuristics — no LLM.
//   2. Perform the merge: reparent meetings/signals/followups/tags/threads
//      from the donor row to the kept row, then call Haiku to reconcile
//      the row-level fields (display_name / context / needs / offers /
//      roles / trajectory_tags / aliases) and apply the result.

import type { Env } from '../../worker-configuration';
import type { PersonRow } from './db';
import { parseJsonArray, parseJsonObject } from './db';
import { jsonCall, MODEL_HAIKU, cached } from './anthropic';
import { upsertPersonVector } from './embed';
import { nowIso } from './ulid';

export interface CandidateScore {
  person: PersonRow;
  score: number;
  reasons: string[];
}

const MIN_SCORE = 25;
const MAX_CANDIDATES = 10;

export async function rankMergeCandidates(
  env: Env,
  targetId: string,
): Promise<CandidateScore[]> {
  const target = await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(targetId).first<PersonRow>();
  if (!target) return [];

  const allRes = await env.DB.prepare('SELECT * FROM people WHERE id != ?1').bind(targetId).all<PersonRow>();
  const all = allRes.results ?? [];

  const scored: CandidateScore[] = [];
  for (const p of all) {
    const s = scoreCandidate(target, p);
    if (s.score >= MIN_SCORE) scored.push(s);
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_CANDIDATES);
}

function scoreCandidate(target: PersonRow, cand: PersonRow): CandidateScore {
  const reasons: string[] = [];
  let score = 0;

  const tEmail = (target.primary_email ?? '').toLowerCase();
  const cEmail = (cand.primary_email ?? '').toLowerCase();
  const tLocal = tEmail.split('@')[0] ?? '';
  const cLocal = cEmail.split('@')[0] ?? '';
  const tDomain = tEmail.split('@')[1] ?? '';
  const cDomain = cEmail.split('@')[1] ?? '';

  if (tLocal && cLocal && tLocal === cLocal) {
    score += 60;
    reasons.push('same email local-part');
  } else if (tLocal && cLocal) {
    const prefix = commonPrefix(tLocal, cLocal);
    if (prefix.length >= 5) {
      score += 30 + Math.min(20, prefix.length - 5);
      reasons.push(`email prefix "${prefix}"`);
    }
  }
  if (tDomain && cDomain && tDomain === cDomain) {
    score += 5;
    reasons.push('same email domain');
  }

  const tName = (target.display_name ?? '').toLowerCase().trim();
  const cName = (cand.display_name ?? '').toLowerCase().trim();
  const tTokens = tName.split(/\s+/).filter(Boolean);
  const cTokens = cName.split(/\s+/).filter(Boolean);
  if (tTokens[0] && cTokens[0] && tTokens[0] === cTokens[0]) {
    score += 40;
    reasons.push('same first name');
  }
  if (
    tTokens.length > 1 &&
    cTokens.length > 1 &&
    tTokens[tTokens.length - 1] === cTokens[cTokens.length - 1]
  ) {
    score += 25;
    reasons.push('same last name');
  }

  // Single-name vs full-name match (Alex ↔ Alex Smith).
  if (tTokens.length === 1 && cTokens.length > 1 && cTokens.includes(tTokens[0]!)) {
    score += 30;
    reasons.push(`"${tTokens[0]}" appears in candidate's full name`);
  } else if (cTokens.length === 1 && tTokens.length > 1 && tTokens.includes(cTokens[0]!)) {
    score += 30;
    reasons.push(`candidate's name appears as a token of target`);
  }

  // Levenshtein on the full lowered name.
  if (tName && cName && Math.abs(tName.length - cName.length) <= 3) {
    const d = levenshtein(tName, cName);
    if (d <= 2 && d > 0) {
      score += 20;
      reasons.push(`name distance ${d}`);
    }
  }

  // Aliases on either side.
  const tAliases = parseJsonArray(target.aliases).map((a) => a.toLowerCase());
  const cAliases = parseJsonArray(cand.aliases).map((a) => a.toLowerCase());
  if (
    (cName && tAliases.includes(cName)) ||
    (tName && cAliases.includes(tName))
  ) {
    score += 50;
    reasons.push('alias match');
  }
  if (cEmail && tAliases.includes(cEmail)) {
    score += 50;
    reasons.push('email matches alias');
  }

  return { person: cand, score, reasons };
}

function commonPrefix(a: string, b: string): string {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return a.slice(0, i);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) dp[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] =
        a[i - 1] === b[j - 1]
          ? prev
          : 1 + Math.min(prev, dp[j - 1]!, dp[j]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

// ---------------------------------------------------------------------------

export interface MergeResult {
  keptId: string;
  donorId: string;
}

const MERGE_SYSTEM = `You merge two CRM person records into one canonical
record. You are given JSON for KEEP (the row we want to retain — its id
stays) and DONOR (the row that will be deleted).

Rules:
- Prefer the longer / more-specific value for: display_name, primary_email,
  geo, context, needs, offers.
- If KEEP.context_manual_override is 1, KEEP.context wins regardless.
- Union all array fields (roles, trajectory_tags, aliases). Add the donor's
  display_name into aliases if it differs from the kept name.
- Merge status objects (sparse). KEEP wins on key conflicts.
- Use ISO date for last_met_date — pick the more recent.

Return JSON exactly matching this schema:
{
  "display_name": string|null,
  "primary_email": string|null,
  "geo": string|null,
  "context": string|null,
  "needs": string|null,
  "offers": string|null,
  "roles": string[],
  "trajectory_tags": string[],
  "aliases": string[],
  "status": object,
  "last_met_date": string|null
}`;

interface MergedFields {
  display_name: string | null;
  primary_email: string | null;
  geo: string | null;
  context: string | null;
  needs: string | null;
  offers: string | null;
  roles: string[];
  trajectory_tags: string[];
  aliases: string[];
  status: Record<string, unknown>;
  last_met_date: string | null;
}

export async function mergePeople(
  env: Env,
  keptId: string,
  donorId: string,
): Promise<MergeResult> {
  if (keptId === donorId) throw new Error('cannot merge a person into themselves');

  const keep = await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(keptId).first<PersonRow>();
  const donor = await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(donorId).first<PersonRow>();
  if (!keep || !donor) throw new Error('keep or donor person not found');

  // Reparent dependent rows. Uses a batch so any failure rolls back together.
  await env.DB.batch([
    env.DB.prepare(`UPDATE meetings SET person_id = ?1 WHERE person_id = ?2`).bind(keptId, donorId),
    env.DB.prepare(`UPDATE signals SET person_id = ?1 WHERE person_id = ?2`).bind(keptId, donorId),
    env.DB.prepare(`UPDATE followups SET person_id = ?1 WHERE person_id = ?2`).bind(keptId, donorId),
    // person_tags: copy any donor tags the keep doesn't already have, then
    // delete donor's rows. SQLite doesn't support ON CONFLICT DO NOTHING
    // across separate statements cleanly here, so we use INSERT OR IGNORE.
    env.DB.prepare(
      `INSERT OR IGNORE INTO person_tags (person_id, tag_id, source_meeting_id, created_at)
       SELECT ?1, tag_id, source_meeting_id, created_at FROM person_tags WHERE person_id = ?2`,
    ).bind(keptId, donorId),
    env.DB.prepare(`DELETE FROM person_tags WHERE person_id = ?1`).bind(donorId),
    env.DB.prepare(`UPDATE chat_threads SET person_id = ?1 WHERE person_id = ?2`).bind(keptId, donorId),
  ]);

  // Reconcile row-level fields via Haiku.
  let merged: MergedFields;
  try {
    merged = await jsonCall<MergedFields>(env, {
      model: MODEL_HAIKU,
      systemBlocks: [cached(MERGE_SYSTEM)],
      userMessage: JSON.stringify({
        keep: rowToJson(keep),
        donor: rowToJson(donor),
      }),
      maxTokens: 800,
    });
  } catch (err) {
    console.error('mergePeople: Haiku reconciliation failed, falling back to local merge', err);
    merged = localMerge(keep, donor);
  }

  // Normalize / safety: don't let the LLM nuke fields the locals had.
  const finalAliases = uniq([
    ...parseJsonArray(keep.aliases),
    ...parseJsonArray(donor.aliases),
    ...(merged.aliases ?? []),
    ...(donor.display_name && donor.display_name !== merged.display_name ? [donor.display_name] : []),
  ]);
  const finalRoles = uniq([
    ...(merged.roles ?? []),
    ...parseJsonArray(keep.roles),
    ...parseJsonArray(donor.roles),
  ]);
  const finalTraj = uniq([
    ...(merged.trajectory_tags ?? []),
    ...parseJsonArray(keep.trajectory_tags),
    ...parseJsonArray(donor.trajectory_tags),
  ]);
  const finalStatus = {
    ...parseJsonObject(donor.status),
    ...parseJsonObject(keep.status),
    ...(merged.status ?? {}),
  };
  const finalContext = keep.context_manual_override
    ? keep.context
    : merged.context ?? keep.context ?? donor.context ?? null;

  const now = nowIso();
  await env.DB.prepare(
    `UPDATE people
     SET display_name = ?1,
         primary_email = ?2,
         geo = ?3,
         context = ?4,
         needs = ?5,
         offers = ?6,
         roles = ?7,
         trajectory_tags = ?8,
         aliases = ?9,
         status = ?10,
         last_met_date = ?11,
         updated_at = ?12
     WHERE id = ?13`,
  ).bind(
    merged.display_name ?? keep.display_name,
    merged.primary_email ?? keep.primary_email,
    merged.geo ?? keep.geo,
    finalContext,
    merged.needs ?? keep.needs,
    merged.offers ?? keep.offers,
    JSON.stringify(finalRoles),
    JSON.stringify(finalTraj),
    JSON.stringify(finalAliases),
    JSON.stringify(finalStatus),
    pickLatestDate(keep.last_met_date, donor.last_met_date, merged.last_met_date),
    now,
    keptId,
  ).run();

  // Recompute meeting_count from the now-reparented meetings table.
  await env.DB.prepare(
    `UPDATE people
     SET meeting_count = (SELECT COUNT(*) FROM meetings WHERE person_id = ?1)
     WHERE id = ?1`,
  ).bind(keptId).run();

  // Delete donor row. CASCADE handles the rest (and we already moved the
  // dependents above).
  await env.DB.prepare(`DELETE FROM people WHERE id = ?1`).bind(donorId).run();

  // Re-embed the kept person with the new context/needs/offers.
  const fresh = await env.DB.prepare(
    'SELECT context, needs, offers FROM people WHERE id = ?1',
  ).bind(keptId).first<{ context: string | null; needs: string | null; offers: string | null }>();
  const text = [fresh?.context, fresh?.needs, fresh?.offers].filter(Boolean).join('\n\n');
  if (text.length > 0) {
    try {
      await upsertPersonVector(env, keptId, text);
    } catch (err) {
      console.error('mergePeople: re-embedding failed', err);
    }
  }

  return { keptId, donorId };
}

function rowToJson(p: PersonRow): Record<string, unknown> {
  return {
    id: p.id,
    primary_email: p.primary_email,
    display_name: p.display_name,
    aliases: parseJsonArray(p.aliases),
    roles: parseJsonArray(p.roles),
    trajectory_tags: parseJsonArray(p.trajectory_tags),
    status: parseJsonObject(p.status),
    geo: p.geo,
    context: p.context,
    needs: p.needs,
    offers: p.offers,
    last_met_date: p.last_met_date,
    meeting_count: p.meeting_count,
    context_manual_override: p.context_manual_override,
  };
}

function localMerge(keep: PersonRow, donor: PersonRow): MergedFields {
  return {
    display_name: longer(keep.display_name, donor.display_name),
    primary_email: keep.primary_email ?? donor.primary_email,
    geo: longer(keep.geo, donor.geo),
    context: keep.context_manual_override
      ? keep.context
      : longer(keep.context, donor.context),
    needs: longer(keep.needs, donor.needs),
    offers: longer(keep.offers, donor.offers),
    roles: uniq([...parseJsonArray(keep.roles), ...parseJsonArray(donor.roles)]),
    trajectory_tags: uniq([
      ...parseJsonArray(keep.trajectory_tags),
      ...parseJsonArray(donor.trajectory_tags),
    ]),
    aliases: uniq([
      ...parseJsonArray(keep.aliases),
      ...parseJsonArray(donor.aliases),
    ]),
    status: { ...parseJsonObject(donor.status), ...parseJsonObject(keep.status) },
    last_met_date: pickLatestDate(keep.last_met_date, donor.last_met_date, null),
  };
}

function longer(a: string | null | undefined, b: string | null | undefined): string | null {
  const av = (a ?? '').trim();
  const bv = (b ?? '').trim();
  if (!av && !bv) return null;
  if (av.length >= bv.length) return av || null;
  return bv || null;
}

function uniq(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

function pickLatestDate(...dates: Array<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (!d) continue;
    if (!best || d > best) best = d;
  }
  return best;
}
