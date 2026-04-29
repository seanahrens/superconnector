// Free-form dictation that runs through the same extraction pipeline as
// Granola notes. The user says "I just met Sarah at OpenAI…" or "Sarah just
// left OpenAI" and the tool resolves/creates the person and applies updates.

import type { Tool } from './types';
import { resolvePerson } from '../lib/resolve';
import { extractFromMeeting } from '../lib/extract';
import { applyExtractionResult } from '../lib/people_writes';
import { ulid, nowIso } from '../lib/ulid';

interface Input {
  name?: string;
  email?: string;
  text: string;
  source: 'user_dictation' | 'manual';
}

interface Output {
  person_id: string;
  meeting_id: string;
  created_person: boolean;
  ambiguous_resolution: boolean;
}

export const dictateTool: Tool<Input, Output> = {
  name: 'dictate',
  description:
    'Add freetext info about a person ("Sarah just left OpenAI", "I met Alex at the AISI dinner — he\'s exploring founding"). Resolves or creates the person and runs the same extraction pipeline as Granola notes.',
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
        meeting_id: '',
        created_person: false,
        ambiguous_resolution: true,
      };
    }
    const meetingId = ulid();
    const now = nowIso();
    await env.DB.prepare(
      `INSERT INTO meetings (
         id, person_id, source, source_ref, recorded_at, meeting_context,
         calendar_match_confidence, event_title, event_start, event_end,
         attendees_at_match, transcript, summary, classification, created_at
       ) VALUES (?1,?2,?3,NULL,?4,NULL,NULL,NULL,NULL,NULL,NULL,?5,NULL,'1:1',?6)`,
    ).bind(meetingId, r.personId, input.source, now, input.text, now).run();

    const result = await extractFromMeeting(env, {
      source: input.source,
      transcript: input.text,
    });
    await applyExtractionResult(env, { personId: r.personId, meetingId, result });

    return {
      person_id: r.personId,
      meeting_id: meetingId,
      created_person: r.created,
      ambiguous_resolution: false,
    };
  },
};
