// Generic match play: given a target person and a candidate role, find candidates
// via vector similarity + role/trajectory filter, then have Sonnet rank them
// with quoted justifications.

import type { Env } from '../../worker-configuration';
import { jsonCall, MODEL_SONNET, cached } from '../lib/anthropic';
import type { PersonRow } from '../lib/db';
import { parseJsonArray } from '../lib/db';
import { querySimilarPeople } from '../lib/embed';
import { loadPersonView, summarizePersonForPrompt } from '../lib/person_view';
import { getRolePack } from '../lib/role_packs';

const RANK_SYSTEM = `You rank candidate matches for the user. The user is a superconnector helping people in an ecosystem.

Output JSON exactly:
{
  "ranked": [
    {
      "person_id": string,
      "score": number,            // 0..1, higher = better fit
      "justification": string,    // 1-2 sentences referencing concrete quoted facts
      "concrete_next_step": string // what should the user actually do
    }
  ]
}

Rules:
- Drop candidates whose fit is weak (< 0.3 score). Better fewer-strong than many-weak.
- Justifications must reference real facts from the candidate's record (quote a phrase if helpful).
- Concrete next steps: "draft intro to X mentioning Y", "send role-pack questions to Z", etc.`;

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
): Promise<Array<{ person_id: string; score: number; justification: string; concrete_next_step: string }>> {
  const opts = matchKindOptions(kind);
  const targetView = await loadPersonView(env, targetPersonId);
  if (!targetView) return [];

  const queryText = [
    targetView.person.context,
    targetView.person.needs,
    targetView.person.offers,
  ].filter(Boolean).join('\n\n') || (targetView.person.display_name ?? '');

  const pool = await querySimilarPeople(env, queryText, opts.poolSize ?? 30, targetPersonId);
  if (pool.length === 0) return [];

  const ids = pool.map((p) => p.personId);
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
  const candidates = await env.DB.prepare(
    `SELECT * FROM people WHERE id IN (${placeholders})`,
  ).bind(...ids).all<PersonRow>();

  const filtered = (candidates.results ?? []).filter((p) => {
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

  const candidateSummaries = filtered.slice(0, opts.topK ?? 12).map((c) => ({
    person_id: c.id,
    display_name: c.display_name,
    roles: parseJsonArray(c.roles),
    trajectory_tags: parseJsonArray(c.trajectory_tags),
    context: c.context,
    needs: c.needs,
    offers: c.offers,
    last_met_date: c.last_met_date,
  }));

  const targetPack = getRolePack(targetView.roles[0] ?? '') ?? null;

  const ranked = await jsonCall<{ ranked: Array<{
    person_id: string;
    score: number;
    justification: string;
    concrete_next_step: string;
  }> }>(env, {
    model: MODEL_SONNET,
    systemBlocks: [cached(RANK_SYSTEM)],
    userMessage: JSON.stringify({
      match_kind: kind,
      target_person: summarizePersonForPrompt(targetView),
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
