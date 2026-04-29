import type { Env } from '../../worker-configuration';
import type { IcsEvent } from './ics';
import { cached, jsonCall, MODEL_HAIKU } from './anthropic';

export type Classification = '1:1' | 'group' | 'ambiguous';

const CLASSIFY_GUIDE = `You classify meeting notes as 1:1, group, or ambiguous.

Inputs you may receive:
- Note title
- Note summary (may be empty)
- Calendar event title (may differ from the note)
- Calendar attendee list (may be missing)

Decision rules:
- If attendees list is present: 1 attendee besides the user → "1:1"; >1 → "group".
- If attendees missing but title clearly implies group ("standup", "sync", "team", "all-hands", multiple names listed) → "group".
- If title clearly implies 1:1 ("1:1 with X", "Coffee w/ X", "Catch up — X", "X / Y" where Y is the user) → "1:1".
- Otherwise → "ambiguous".

Respond with JSON:
{"classification": "1:1" | "group" | "ambiguous", "confidence": 0..1, "reason": "<one short sentence>"}`;

export interface ClassifyInput {
  noteTitle: string | null;
  noteSummary: string | null;
  eventTitle?: string | null;
  attendees?: Array<{ email: string | null; name: string | null }>;
}

export interface ClassifyResult {
  classification: Classification;
  confidence: number;
  reason: string;
}

export async function classifyMeeting(env: Env, input: ClassifyInput): Promise<ClassifyResult> {
  // Fast path: attendees-known case never needs the LLM.
  if (input.attendees && input.attendees.length > 0) {
    if (input.attendees.length === 1) {
      return { classification: '1:1', confidence: 1, reason: 'single calendar attendee' };
    }
    if (input.attendees.length > 1) {
      return {
        classification: 'group',
        confidence: 1,
        reason: `${input.attendees.length} calendar attendees`,
      };
    }
  }

  const userBody = JSON.stringify({
    note_title: input.noteTitle ?? '',
    note_summary: input.noteSummary ?? '',
    event_title: input.eventTitle ?? '',
    attendees: input.attendees ?? [],
  });

  return await jsonCall<ClassifyResult>(env, {
    model: MODEL_HAIKU,
    systemBlocks: [cached(CLASSIFY_GUIDE)],
    userMessage: userBody,
    maxTokens: 256,
  });
}

export function bestEventForNote(
  candidates: IcsEvent[],
  noteTitle: string | null,
): { event: IcsEvent | null; confidence: number } {
  if (candidates.length === 0) return { event: null, confidence: 0 };
  if (candidates.length === 1) return { event: candidates[0]!, confidence: 0.9 };

  // Use title overlap (jaccard on lowercased word set) to pick among overlapping events.
  const target = tokenize(noteTitle ?? '');
  let best = candidates[0]!;
  let bestScore = -1;
  for (const e of candidates) {
    const score = jaccard(target, tokenize(e.summary ?? ''));
    if (score > bestScore) {
      best = e;
      bestScore = score;
    }
  }
  return { event: best, confidence: 0.5 + 0.5 * Math.max(0, bestScore) };
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
