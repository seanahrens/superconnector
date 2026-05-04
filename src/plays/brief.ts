import type { Env } from '../../worker-configuration';
import { jsonCall, MODEL_SONNET, cached } from '../lib/anthropic';
import { loadPersonView, summarizePersonForPrompt } from '../lib/person_view';
import { packsForRoles } from '../lib/role_packs';

const BRIEF_SYSTEM = `You write a tight pre-meeting briefing for You (the sole CRM owner, degree=0), who is about to meet this person. Address You as "You" in any prose; never say "the user".

Output JSON exactly:
{
  "headline": string,                  // one sentence: who they are and the current state of things
  "recent_context": string,            // 2-4 sentences pulling on the most relevant signals
  "suggested_questions": string[],     // 3-6 questions worth asking; mix canonical + person-specific gaps
  "missing_data_prompts": string[],    // questions targeting fields You have no answer for yet
  "open_followups": string[],          // any open commitments from prior meetings You should close
  "match_opportunities": string[]      // intros / connections worth surfacing in conversation, if any. NEVER suggest introducing You — You are the meeter, not a candidate.
}

Be concrete. Don't restate the structured data verbatim — synthesize.`;

export interface BriefResult {
  headline: string;
  recent_context: string;
  suggested_questions: string[];
  missing_data_prompts: string[];
  open_followups: string[];
  match_opportunities: string[];
}

export async function briefForPerson(env: Env, personId: string): Promise<BriefResult | null> {
  const view = await loadPersonView(env, personId);
  if (!view) return null;

  const packs = packsForRoles(view.roles);
  const canonicalQuestions = packs.flatMap((p) => p.canonical_questions);

  const userBody = JSON.stringify({
    person_summary: summarizePersonForPrompt(view),
    canonical_questions_for_their_roles: canonicalQuestions,
    role_pack_emphasis: packs.map((p) => `${p.label}: ${p.extraction_emphasis}`),
  });

  return await jsonCall<BriefResult>(env, {
    model: MODEL_SONNET,
    systemBlocks: [cached(BRIEF_SYSTEM)],
    userMessage: userBody,
    maxTokens: 1200,
  });
}
