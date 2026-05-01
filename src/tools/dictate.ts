// Free-form dictation that runs through the same extraction pipeline as
// Granola notes. The user says "I just met Sarah at OpenAI…" or "Sarah just
// left OpenAI" and the tool resolves/creates the person and applies updates.
//
// Important: dictation is *annotation*, not a meeting record. We do NOT
// create a meetings row, do NOT bump meeting_count, and do NOT touch
// last_met_date. Otherwise dictating "Met Tom at Blue Dot Dinner on Feb 20"
// in late April would create a phantom Feb-20 meeting on the user's
// timeline, which is misleading. Signals carry the dictated facts with
// meeting_id NULL.

import type { Tool } from './types';
import { resolvePerson } from '../lib/resolve';
import { extractFromMeeting } from '../lib/extract';
import { applyExtractionResult } from '../lib/people_writes';

interface Input {
  name?: string;
  email?: string;
  text: string;
  source: 'user_dictation' | 'manual';
}

interface Output {
  person_id: string;
  created_person: boolean;
  ambiguous_resolution: boolean;
}

export const dictateTool: Tool<Input, Output> = {
  name: 'dictate',
  description:
    'Add freetext info about a person ("Sarah just left OpenAI", "I met Alex at the AISI dinner — he\'s exploring founding"). Resolves or creates the person and runs the same extraction pipeline as Granola notes. Does NOT record a meeting — use this for annotation, not for logging that a meeting happened.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      text: { type: 'string' },
      source: { type: 'string', enum: ['user_dictation', 'manual'] },
    },
    required: ['text', 'source'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const r = await resolvePerson(env, { email: input.email, name: input.name });
    if (r.ambiguous) {
      return {
        person_id: '',
        created_person: false,
        ambiguous_resolution: true,
      };
    }

    const result = await extractFromMeeting(env, {
      source: input.source,
      transcript: input.text,
    });
    // meetingId: null → applyExtractionResult skips meeting_count + last_met_date
    // and inserts signals with meeting_id NULL (annotation-only path).
    await applyExtractionResult(env, {
      personId: r.personId,
      meetingId: null,
      result,
    });

    return {
      person_id: r.personId,
      created_person: r.created,
      ambiguous_resolution: false,
    };
  },
};
