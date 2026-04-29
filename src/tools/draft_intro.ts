import type { Tool } from './types';
import { jsonCall, MODEL_SONNET, cached } from '../lib/anthropic';
import { loadPersonView, summarizePersonForPrompt } from '../lib/person_view';

interface Input {
  person_a_id: string;
  person_b_id: string;
  premise?: string;
}

interface Output {
  subject: string;
  body: string;
  notes_for_user: string;
}

const SYSTEM = `You draft a warm intro email between two people for the user, who is a connector.

Output JSON exactly:
{
  "subject": string,
  "body": string,                // plain text email body, 3-5 short paragraphs
  "notes_for_user": string       // 1-2 sentences explaining the connection rationale
}

Rules:
- Use first names. Address both A and B in the same body.
- Quote 1-2 concrete facts from each person's record.
- Keep it short. The user will lightly edit before sending.
- Don't fabricate context. If something's missing, leave it out.`;

export const draftIntroTool: Tool<Input, Output> = {
  name: 'draft_intro',
  description: 'Draft a warm intro email between two people, grounded in what we know about each.',
  inputSchema: {
    type: 'object',
    properties: {
      person_a_id: { type: 'string' },
      person_b_id: { type: 'string' },
      premise: { type: 'string', description: 'Optional one-line description of why these two should meet.' },
    },
    required: ['person_a_id', 'person_b_id'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const [a, b] = await Promise.all([
      loadPersonView(env, input.person_a_id),
      loadPersonView(env, input.person_b_id),
    ]);
    if (!a || !b) throw new Error('person not found');
    return await jsonCall<Output>(env, {
      model: MODEL_SONNET,
      systemBlocks: [cached(SYSTEM)],
      userMessage: JSON.stringify({
        person_a: summarizePersonForPrompt(a),
        person_b: summarizePersonForPrompt(b),
        premise: input.premise ?? null,
      }),
      maxTokens: 1024,
    });
  },
};
