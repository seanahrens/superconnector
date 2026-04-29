import type { Tool } from './types';
import { briefForPerson, type BriefResult } from '../plays/brief';

interface Input {
  person_id: string;
}

export const briefForTool: Tool<Input, { brief: BriefResult | null }> = {
  name: 'brief_for',
  description: 'Generate a pre-meeting briefing for a person.',
  inputSchema: {
    type: 'object',
    properties: { person_id: { type: 'string' } },
    required: ['person_id'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const brief = await briefForPerson(env, input.person_id);
    return { brief };
  },
};
