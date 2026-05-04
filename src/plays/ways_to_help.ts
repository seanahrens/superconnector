// "Ways to help your contacts today" — top-N suggestions across the whole graph.
// Sample recently-active people, generate match candidates per their need shape,
// then have Sonnet rank the global top-N.

import type { Env } from '../../worker-configuration';
import { jsonCall, MODEL_SONNET, cached } from '../lib/anthropic';
import type { PersonRow } from '../lib/db';
import { parseJsonArray, sqlPlaceholders } from '../lib/db';
import { querySimilarPeople } from '../lib/embed';

const RANK_SYSTEM = `You select the highest-leverage "ways to help" actions for You today. You are the sole CRM owner (degree=0). Address You as "You" in any prose; never say "the user".

CRITICAL: Every person in the input list is someone OTHER than You — You are not in the candidate list and must never appear as primary_person_id or secondary_person_id. Do NOT recommend introducing You to anyone, or recommend that anyone reach out to You. The "intro" kind is two non-You people You could introduce TO EACH OTHER.

Each candidate carries a \`degree\` field: 1 = You already know them directly, 2 = You'd need an intro yourself to reach them. For degree=2 entries, factor in that You'd need to be intro'd before You can act.

Output JSON exactly:
{
  "items": [
    {
      "kind": "intro" | "reach_out" | "share" | "ask",
      "primary_person_id": string,
      "secondary_person_id"?: string,
      "headline": string,
      "justification": string,
      "concrete_next_step": string,
      "score": number          // 0..1
    }
  ]
}

Rules:
- Aim for ~5 items, never more than 10. Quality > quantity.
- Mix at least two kinds when possible.
- Justifications must quote concrete facts from the records.`;

export interface WaysToHelpItem {
  kind: 'intro' | 'reach_out' | 'share' | 'ask';
  primary_person_id: string;
  secondary_person_id?: string;
  headline: string;
  justification: string;
  concrete_next_step: string;
  score: number;
}

export async function waysToHelp(env: Env, limit: number = 5): Promise<WaysToHelpItem[]> {
  // Source: top-K most recently active people who have any context to match
  // on. Exclude You (degree=0) — never seed or recommend introductions
  // involving the user themselves.
  const seedRes = await env.DB.prepare(
    `SELECT * FROM people
     WHERE degree != 0
       AND ((context IS NOT NULL AND length(context) > 30)
            OR (needs IS NOT NULL AND length(needs) > 10))
     ORDER BY last_met_date DESC NULLS LAST
     LIMIT 20`,
  ).all<PersonRow>();
  const seeds = seedRes.results ?? [];
  if (seeds.length === 0) return [];

  // For each seed, gather a small candidate set via vectors. Cap total to avoid runaway prompts.
  const candidateMap = new Map<string, PersonRow>();
  for (const seed of seeds.slice(0, 8)) {
    const text = [seed.context, seed.needs, seed.offers].filter(Boolean).join('\n\n');
    if (!text) continue;
    const matches = await querySimilarPeople(env, text, 5, seed.id);
    if (matches.length === 0) continue;
    const ids = matches.map((m) => m.personId);
    const rows = await env.DB.prepare(`SELECT * FROM people WHERE id IN (${sqlPlaceholders(ids)})`).bind(...ids).all<PersonRow>();
    for (const row of rows.results ?? []) {
      // querySimilarPeople already filters degree=0, but defend in depth.
      if (row.degree === 0) continue;
      candidateMap.set(row.id, row);
    }
    candidateMap.set(seed.id, seed);
  }

  const allPeople = [...candidateMap.values()];
  if (allPeople.length === 0) return [];

  const peopleSummaries = allPeople.map((p) => ({
    person_id: p.id,
    display_name: p.display_name,
    roles: parseJsonArray(p.roles),
    trajectory_tags: parseJsonArray(p.trajectory_tags),
    context: p.context,
    needs: p.needs,
    offers: p.offers,
    last_met_date: p.last_met_date,
    degree: p.degree,
  }));

  const result = await jsonCall<{ items: WaysToHelpItem[] }>(env, {
    model: MODEL_SONNET,
    systemBlocks: [cached(RANK_SYSTEM)],
    userMessage: JSON.stringify({
      target_count: limit,
      people: peopleSummaries,
    }),
    maxTokens: 2048,
  });
  return (result.items ?? []).sort((a, b) => b.score - a.score).slice(0, limit);
}
