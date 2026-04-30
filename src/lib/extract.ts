import type { Env } from '../../worker-configuration';
import { cached, jsonCall, MODEL_HAIKU } from './anthropic';

const EXTRACT_GUIDE = `You extract structured updates from a meeting transcript or freetext dictation. The transcript has TWO parties:

- "[microphone]" turns are the USER (the owner of this CRM) speaking. When they say things about themselves ("I just left FAR Labs", "I'm raising a seed round"), update the USER record.
- "[speaker]" turns are the COUNTERPART (the other person on the call). Use these to update the COUNTERPART record.

If userPerson is null in the input, ignore microphone-side self-statements (no user record yet exists). Always populate person_updates / signals for the counterpart even when userPerson is present.

Goals:
- Capture concrete signals (needs, offers, status changes, commitments) with confidence scores.
- Update an LLM-maintained narrative \`context\` (paragraph) and freetext \`needs\` and \`offers\` fields.
- Propose tags (emergent, lowercase, slash-namespaced when applicable, e.g. "trajectory/exploring founding").
- Pull out followups the user has committed to ("I'll intro X to Y") — these always attach to the counterpart's profile.

Output shape (JSON, exactly this schema):
{
  "person_updates": {                 // updates for the COUNTERPART
    "display_name"?: string,
    "context_delta"?: string,
    "needs_replacement"?: string,
    "offers_replacement"?: string,
    "roles_add"?: string[],
    "trajectory_tags_add"?: string[],
    "home_location"?: string,         // city/area where they LIVE
    "work_location"?: string,         // city/area where they WORK ("Remote" if remote)
    "work_org"?: string,              // organization they work at, distinct from roles
    "status_patch"?: object
  },
  "signals": [
    { "kind": "need"|"offer"|"status_change"|"commitment"|"note",
      "body": string,
      "confidence": number }
  ],
  "user_updates"?: {                  // updates for the USER (microphone speaker), same shape; omit if nothing extracted
    "display_name"?: string,
    "context_delta"?: string,
    "needs_replacement"?: string,
    "offers_replacement"?: string,
    "roles_add"?: string[],
    "trajectory_tags_add"?: string[],
    "home_location"?: string,
    "work_location"?: string,
    "work_org"?: string,
    "status_patch"?: object
  },
  "user_signals"?: [
    { "kind": "need"|"offer"|"status_change"|"commitment"|"note",
      "body": string,
      "confidence": number }
  ],
  "tag_proposals": [{ "name": string, "category": "trajectory"|"topic"|"skill"|"free" }],
  "followups": [{ "body": string, "due_date"?: string }],
  "summary": string,
  "extraction_confidence": number
}

Tags use SPACES, not underscores (e.g. "trajectory/raising seed"). The slash stays as the namespace separator.

Rules:
- Be conservative. Confidence < 0.6 means the user must confirm.
- Only extract things the source actually states or strongly implies.
- Don't invent dates. Use ISO 8601 if present in source.
- Don't include the user's own opinions about the counterpart; stick to what was said.
- For user_updates / user_signals, ONLY use first-person statements made BY the [microphone] speaker. Don't put speculation about the user there.`;

interface PersonContext {
  displayName: string | null;
  context: string | null;
  needs: string | null;
  offers: string | null;
  roles: string[];
  trajectoryTags: string[];
}

export interface ExtractInput {
  source: 'granola' | 'user_dictation' | 'manual';
  noteTitle?: string | null;
  noteSummary?: string | null;
  transcript?: string | null;
  meetingContext?: string | null;
  existingPerson?: PersonContext;
  /** The user (microphone speaker) profile when known, so the LLM can
      also update self-statements made by the user. */
  userPerson?: PersonContext;
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
  home_location?: string;
  work_location?: string;
  work_org?: string;
  status_patch?: Record<string, unknown>;
}

export interface ExtractionResult {
  person_updates: ExtractedPersonUpdates;
  signals: ExtractedSignal[];
  /** Self-statements by the [microphone] speaker — updates for the user. */
  user_updates?: ExtractedPersonUpdates;
  user_signals?: ExtractedSignal[];
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
    user_person: input.userPerson ?? null,
    role_pack_hint: input.rolePackHint ?? null,
  });

  return await jsonCall<ExtractionResult>(env, {
    model: MODEL_HAIKU,
    systemBlocks: [cached(EXTRACT_GUIDE)],
    userMessage: userBody,
    maxTokens: 4096,
  });
}
