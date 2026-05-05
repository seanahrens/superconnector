// Generic match play: given a target person and a candidate role, find candidates
// via vector similarity + role/trajectory filter, then have Sonnet rank them
// using the "interlocking wants" framing — both sides have wants, and a match
// is a pair whose wants interlock.

import type { Env } from '../../worker-configuration';
import { jsonCall, MODEL_SONNET, cached } from '../lib/anthropic';
import type { PersonRow } from '../lib/db';
import { parseJsonArray, sqlPlaceholders } from '../lib/db';
import { querySimilarPeople } from '../lib/embed';
import { loadPersonView, summarizePersonForPrompt } from '../lib/person_view';
import { getRolePack } from '../lib/role_packs';
import { loadActiveWants, wantForPrompt } from '../lib/wants';

const RANK_SYSTEM = `You rank candidate matches for You (the sole CRM owner, degree=0). You are a superconnector helping people in an ecosystem. Address You as "You" in any prose; never say "the user". Never propose You yourself as a candidate — degree=0 is You, not a match.

CONCEPTUAL FRAME — interlocking wants, not need↔offer:
Every person has WANTS — things they're trying to do, get, give, or make
happen. Some are stated explicitly (in \`wants\` text and \`signals\`); others
are inferred from \`roles\`, \`trajectory_tags\`, and \`context\` (a "funder"
implicitly wants deal flow; an experienced CTO implicitly wants meaningful
problems to work on). A match is a pair whose wants INTERLOCK — one person's
want is satisfied by the other person's want being satisfied. Cofounder
matches are typically symmetric (both want a cofounder); founder↔funder is
an interlock of "want capital" with "want deal flow".

WANT RECENCY:
Each want carries \`created_at\` and \`last_validated_at\`. Use your judgment
about whether a want is likely still live — a "hiring a CTO" want from 6
months ago that has not been re-validated is likely stale; a "writing more
about AI safety" identity-level want from 1 year ago is probably still
current. Don't apply a mechanical decay formula; reason about each want.

Output JSON exactly:
{
  "ranked": [
    {
      "person_id": string,
      "score": number,            // 0..1, higher = better fit
      "interlock": string,        // 1 sentence naming the two wants that interlock
      "justification": string,    // 1-2 sentences referencing concrete quoted facts
      "concrete_next_step": string // what You should actually do
    }
  ]
}

Rules:
- Drop candidates whose fit is weak (< 0.3 score). Better fewer-strong than many-weak.
- "interlock" must name a concrete want on each side (target's want ↔ candidate's want).
- Justifications must reference real facts from the candidate's record (quote a phrase if helpful).
- Concrete next steps: "draft intro to X mentioning Y", "send role-pack questions to Z", etc.
- For degree=2 candidates, the next step should account for needing an intro (e.g. "ask <warm contact> for an intro to X").`;

export type MatchKind = 'cofounder' | 'funder' | 'talent' | 'advisor';

interface MatchOptions {
  topK?: number;
  poolSize?: number;
  trajectoryTagFilter?: string;
  candidateRole?: string; // filter pool by candidate's roles[] containing this
}

export async function findMatches(
  env: Env,
  targetPersonId: string,
  kind: MatchKind,
): Promise<Array<{
  person_id: string;
  score: number;
  interlock: string;
  justification: string;
  concrete_next_step: string;
}>> {
  const opts = matchKindOptions(kind);
  const targetView = await loadPersonView(env, targetPersonId);
  if (!targetView) return [];

  // Build the vector query from the target's durable shape (context) plus
  // the rolled-up wants string. The signals carry the structured detail
  // that the LLM ranker reads directly.
  const queryText = [
    targetView.person.context,
    targetView.person.wants,
  ].filter(Boolean).join('\n\n') || (targetView.person.display_name ?? '');

  const pool = await querySimilarPeople(env, queryText, opts.poolSize ?? 30, targetPersonId);
  if (pool.length === 0) return [];

  const ids = pool.map((p) => p.personId);
  const candidates = await env.DB.prepare(
    `SELECT * FROM people WHERE id IN (${sqlPlaceholders(ids)})`,
  ).bind(...ids).all<PersonRow>();

  const filtered = (candidates.results ?? []).filter((p) => {
    // Never propose You as a match for anyone.
    if (p.degree === 0) return false;
    if (opts.candidateRole) {
      const roles = parseJsonArray(p.roles);
      if (!roles.includes(opts.candidateRole)) return false;
    }
    if (opts.trajectoryTagFilter) {
      const traj = parseJsonArray(p.trajectory_tags);
      if (!traj.includes(opts.trajectoryTagFilter)) return false;
    }
    return true;
  });

  if (filtered.length === 0) return [];

  const targetWants = (await loadActiveWants(env, targetPersonId, 20)).map(wantForPrompt);

  const candidateSlice = filtered.slice(0, opts.topK ?? 12);
  const candidateSummaries = await Promise.all(candidateSlice.map(async (c) => {
    const wants = (await loadActiveWants(env, c.id, 12)).map(wantForPrompt);
    return {
      person_id: c.id,
      display_name: c.display_name,
      roles: parseJsonArray(c.roles),
      trajectory_tags: parseJsonArray(c.trajectory_tags),
      context: c.context,
      wants,
      wants_summary: c.wants,
      last_met_date: c.last_met_date,
      degree: c.degree,
    };
  }));

  const targetPack = getRolePack(targetView.roles[0] ?? '') ?? null;

  const ranked = await jsonCall<{ ranked: Array<{
    person_id: string;
    score: number;
    interlock: string;
    justification: string;
    concrete_next_step: string;
  }> }>(env, {
    model: MODEL_SONNET,
    systemBlocks: [cached(RANK_SYSTEM)],
    userMessage: JSON.stringify({
      match_kind: kind,
      target_person: summarizePersonForPrompt(targetView),
      target_wants: targetWants,
      target_role_emphasis: targetPack?.extraction_emphasis ?? null,
      candidates: candidateSummaries,
    }),
    maxTokens: 2048,
  });

  return ranked.ranked.sort((a, b) => b.score - a.score);
}

function matchKindOptions(kind: MatchKind): MatchOptions {
  switch (kind) {
    case 'cofounder':
      return { trajectoryTagFilter: 'open_to_cofounding' };
    case 'funder':
      return { candidateRole: 'funder' };
    case 'talent':
      return { candidateRole: 'talent' };
    case 'advisor':
      return { candidateRole: 'advisor' };
  }
}
