import type { Env } from '../../worker-configuration';
import { cached, jsonCall, MODEL_HAIKU } from './anthropic';
import type { Evidence, SignalKind } from './db';
import { TAG_NAMING_RULES } from './tag_norm';

const EXTRACT_GUIDE = `You extract structured updates from a meeting transcript or freetext dictation. The CRM has a single owner ("You" — the row with degree=0; refer to them as "You" in any prose you write). The transcript has TWO parties:

- "[microphone]" turns are You (the CRM owner) speaking. When You say things about yourself ("I just left FAR Labs", "I'm raising a seed round"), update the YOU record.
- "[speaker]" turns are the COUNTERPART (the other person on the call). Use these to update the COUNTERPART record.

If userPerson is null in the input, ignore microphone-side self-statements (no You record yet exists). Always populate person_updates / signals for the counterpart even when userPerson is present.

CONCEPTUAL MODEL — wants, not needs/offers:
We treat introductions as a marketplace of WANTS, not separate needs and offers.
A want is anything the person is trying to do, get, give, find, or make happen
right now. "Hiring a CTO", "raising a Series A", "wants to mentor early
founders", "looking for a cofounder" — all wants. The matcher pairs wants that
INTERLOCK across two people (founder wants capital ↔ funder wants deal flow).
Do NOT split wants into "needs" vs "offers". One field. One concept.

EVIDENCE — replaces the old confidence float:
Every signal carries an evidence label, not a number:
- "explicit"  — the speaker stated this directly. REQUIRES a verbatim quote in
                 \`source_span\` taken from the transcript or note.
- "inferred"  — derived from surrounding context (the person said something
                 nearby that implies this; or the role/situation implies it).
                 \`source_span\` may be a quote that supports the inference;
                 leave null if there's no clean quote.
- "weak"      — mentioned in passing, hedged, or only loosely implied.

Never mark a signal "explicit" without a real quote. If you can't quote it,
mark it "inferred" or "weak".

ECHO HANDLING — don't duplicate facts you've seen before:
The input includes existing_person.live_wants[] (and user_person.live_wants[]
when applicable). These are wants ALREADY recorded for the person. When the
current note says the same thing again, emit it as an ECHO that points at the
existing signal id — do NOT emit a new "want" signal that duplicates an
existing one. Use a fresh "want" signal only when the want is genuinely new or
materially different. Use "status_change" or a superseding "want" when the
person reports a contradiction (e.g. "we closed the round" vs an existing
"raising a seed round" — emit a status_change AND mark the old want id in
\`supersedes_signal_ids\` on a new signal).

Goals:
- Capture concrete signals (wants, status changes, commitments, notes) with
  evidence + source_span (verbatim quote when explicit).
- Update an LLM-maintained narrative \`context\` (paragraph) and a single
  \`wants\` summary string (point-in-time freetext rollup; the source-of-truth
  is the signals).
- Propose tags (emergent, lowercase, slash-namespaced when applicable, e.g.
  "trajectory/exploring founding").
- Pull out followups the user has committed to ("I'll intro X to Y") — these
  always attach to the counterpart's profile.

Output shape (JSON, exactly this schema):
{
  "person_updates": {                 // updates for the COUNTERPART
    "display_name"?: string,
    "context_delta"?: string,
    "wants_replacement"?: string,
    "roles_add"?: string[],
    "trajectory_tags_add"?: string[],
    "home_location"?: string,         // city/area where they LIVE
    "work_location"?: string,         // city/area where they WORK ("Remote" if remote)
    "work_org"?: string,              // organization they work at, distinct from roles
    "status_patch"?: object
  },
  "signals": [
    { "kind": "want"|"status_change"|"commitment"|"note",
      "body": string,
      "evidence": "explicit"|"inferred"|"weak",
      "source_span"?: string,                    // verbatim quote; required when evidence=="explicit"
      "supersedes_signal_ids"?: string[]         // ids from existing_person.live_wants this signal contradicts
    }
  ],
  "echoes": [                             // wants restated, not new facts
    { "signal_id": string,                // an id from existing_person.live_wants
      "source_span"?: string }            // optional fresh quote affirming the want
  ],
  "user_updates"?: {                  // updates for the USER (microphone speaker), same shape; omit if nothing extracted
    "display_name"?: string,
    "context_delta"?: string,
    "wants_replacement"?: string,
    "roles_add"?: string[],
    "trajectory_tags_add"?: string[],
    "home_location"?: string,
    "work_location"?: string,
    "work_org"?: string,
    "status_patch"?: object
  },
  "user_signals"?: [
    { "kind": "want"|"status_change"|"commitment"|"note",
      "body": string,
      "evidence": "explicit"|"inferred"|"weak",
      "source_span"?: string,
      "supersedes_signal_ids"?: string[] }
  ],
  "user_echoes"?: [
    { "signal_id": string, "source_span"?: string }
  ],
  "tag_proposals": [{ "name": string, "category": "trajectory"|"topic"|"skill"|"free" }],
  "followups": [{ "body": string, "due_date"?: string }],
  "summary": string,
  "extraction_confidence": number
}

Tags use SPACES, not underscores (e.g. "trajectory/raising seed"). The slash stays as the namespace separator.

Rules:
- Be conservative. extraction_confidence < 0.6 means the user must confirm.
- Only extract things the source actually states or strongly implies.
- Don't invent dates. Use ISO 8601 if present in source.
- Don't include Your own opinions about the counterpart; stick to what was said.
- For user_updates / user_signals, ONLY use first-person statements made BY the [microphone] speaker. Don't put speculation about You there.`;

interface PersonContext {
  displayName: string | null;
  context: string | null;
  /** Rolled-up freetext wants (the people.wants column). */
  wants: string | null;
  roles: string[];
  trajectoryTags: string[];
  /** Currently-live, non-superseded want signals on this person, exposed to
   *  the LLM so it can detect echoes and supersession instead of inserting
   *  duplicate rows. Each entry is a snippet — the body and the date last
   *  validated. */
  liveWants?: Array<{ id: string; body: string; last_validated_at: string }>;
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
  kind: SignalKind;
  body: string;
  evidence: Evidence;
  source_span?: string | null;
  /** ids from existing_person.live_wants[] this signal supersedes. */
  supersedes_signal_ids?: string[];
}

export interface ExtractedEcho {
  /** Existing signal id (from existing_person.live_wants[]) being echoed. */
  signal_id: string;
  /** Optional fresh quote affirming the want from the new note. */
  source_span?: string | null;
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
  wants_replacement?: string;
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
  /** Existing wants restated in the new note. Bumps last_validated_at on
   *  the referenced signal rather than inserting a duplicate. */
  echoes?: ExtractedEcho[];
  /** Self-statements by the [microphone] speaker — updates for the user. */
  user_updates?: ExtractedPersonUpdates;
  user_signals?: ExtractedSignal[];
  user_echoes?: ExtractedEcho[];
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
    systemBlocks: [cached(EXTRACT_GUIDE), cached(TAG_NAMING_RULES)],
    userMessage: userBody,
    maxTokens: 4096,
  });
}
