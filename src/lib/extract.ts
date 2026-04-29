import type { Env } from '../../worker-configuration';
import { cached, jsonCall, MODEL_HAIKU } from './anthropic';

const EXTRACT_GUIDE = `You extract structured updates about ONE person from a meeting note transcript or freetext dictation.

Goals:
- Capture concrete signals (needs, offers, status changes, commitments) with confidence scores.
- Update an LLM-maintained narrative \`context\` (paragraph) and freetext \`needs\` and \`offers\` fields.
- Propose tags (emergent, lowercase, slash-namespaced when applicable, e.g. "trajectory/exploring_founding").
- Pull out followups the user has committed to ("I'll intro X to Y").

Output shape (JSON, exactly this schema):
{
  "person_updates": {
    "display_name"?: string,
    "context_delta"?: string,         // appended to existing context with a date marker
    "needs_replacement"?: string,     // full new needs text if it should be rewritten
    "offers_replacement"?: string,    // full new offers text if it should be rewritten
    "roles_add"?: string[],           // canonical: founder|funder|talent|advisor|researcher|operator|engineer
    "trajectory_tags_add"?: string[], // e.g. exploring_founding, open_to_cofounding, raising_seed
    "status_patch"?: object           // sparse merge into status JSON
  },
  "signals": [
    { "kind": "need"|"offer"|"status_change"|"commitment"|"note",
      "body": string,
      "confidence": number }
  ],
  "tag_proposals": [{ "name": string, "category": "trajectory"|"topic"|"skill"|"free" }],
  "followups": [{ "body": string, "due_date"?: string }],
  "summary": string,                  // 1-3 sentence summary of the meeting/dictation
  "extraction_confidence": number     // overall 0..1
}

Rules:
- Be conservative. Confidence < 0.6 means the user must confirm.
- Only extract things the source actually states or strongly implies.
- Don't invent dates. Use ISO 8601 if present in source.
- Don't include the user's own opinions about the person; stick to what was said.`;

export interface ExtractInput {
  source: 'granola' | 'user_dictation' | 'manual';
  noteTitle?: string | null;
  noteSummary?: string | null;
  transcript?: string | null;
  meetingContext?: string | null;
  existingPerson?: {
    displayName: string | null;
    context: string | null;
    needs: string | null;
    offers: string | null;
    roles: string[];
    trajectoryTags: string[];
  };
  rolePackHint?: string;
}

export interface ExtractedSignal {
  kind: 'need' | 'offer' | 'status_change' | 'commitment' | 'note';
  body: string;
  confidence: number;
}

export interface ExtractedFollowup {
  body: string;
  due_date?: string | null;
}

export interface ExtractedTagProposal {
  name: string;
  category: 'trajectory' | 'topic' | 'skill' | 'free';
}

export interface ExtractedPersonUpdates {
  display_name?: string;
  context_delta?: string;
  needs_replacement?: string;
  offers_replacement?: string;
  roles_add?: string[];
  trajectory_tags_add?: string[];
  status_patch?: Record<string, unknown>;
}

export interface ExtractionResult {
  person_updates: ExtractedPersonUpdates;
  signals: ExtractedSignal[];
  tag_proposals: ExtractedTagProposal[];
  followups: ExtractedFollowup[];
  summary: string;
  extraction_confidence: number;
}

export async function extractFromMeeting(
  env: Env,
  input: ExtractInput,
): Promise<ExtractionResult> {
  const userBody = JSON.stringify({
    source: input.source,
    note_title: input.noteTitle ?? null,
    note_summary: input.noteSummary ?? null,
    transcript: input.transcript ?? null,
    meeting_context: input.meetingContext ?? null,
    existing_person: input.existingPerson ?? null,
    role_pack_hint: input.rolePackHint ?? null,
  });

  return await jsonCall<ExtractionResult>(env, {
    model: MODEL_HAIKU,
    systemBlocks: [cached(EXTRACT_GUIDE)],
    userMessage: userBody,
    maxTokens: 4096,
  });
}
