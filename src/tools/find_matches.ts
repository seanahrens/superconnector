import type { Tool } from './types';
import { findMatches, type MatchKind } from '../plays/match';

interface Input {
  person_id: string;
  kind: MatchKind;
}

interface Output {
  ranked: Array<{
    person_id: string;
    score: number;
    justification: string;
    concrete_next_step: string;
  }>;
}

export const findMatchesTool: Tool<Input, Output> = {
  name: 'find_matches',
  description:
    'Find ranked match candidates for a person across the graph. kind selects the match play: cofounder | funder | talent | advisor.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string' },
      kind: { type: 'string', enum: ['cofounder', 'funder', 'talent', 'advisor'] },
    },
    required: ['person_id', 'kind'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const ranked = await findMatches(env, input.person_id, input.kind);
    return { ranked };
  },
};
