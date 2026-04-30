import type { Env } from '../../worker-configuration';
import type { IcsEvent } from './ics';
import type { GranolaTranscriptTurn } from './granola';
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

// ---------------------------------------------------------------------------
// Three-signal vote (TODO A): with Granola Personal API never returning real
// attendees and Proton ICS only carrying recent events, the LLM-only
// classifier in classifyMeeting() falls back to "ambiguous" for everything.
// These cheap heuristics give us strong-enough signal to auto-process the
// clear-cut majority without an LLM call.

export interface VoteResult {
  classification: Classification;
  confidence: number; // 0..1
  counterpartName: string | null;
  reason: string;
}

const FILLER_TITLES = new Set([
  'busy',
  'dr visit',
  'doctor',
  'lunch',
  'workout',
  'gym',
  'meeting',
  'call',
  'sync',
  'note',
  'notes',
  'standup',
  'reminders',
  'errands',
]);

// Pull a counterpart name out of a note title. The patterns cover the common
// shapes seen in this user's Granola feed: "Aaron Hamlin Call",
// "Hugo @ Catalyze Impact", "Sean / Karl", "Sean<>Karl", "Coffee with X",
// "Justin Shenk - Civic Reliability", a bare proper-name title like "Rihki".
export function extractCounterpartFromTitle(
  title: string | null | undefined,
  ownerNameRaw: string | null | undefined,
): { name: string | null; confidence: number } {
  const t = (title ?? '').trim();
  if (!t) return { name: null, confidence: 0 };
  const ownerNorm = (ownerNameRaw ?? '').toLowerCase().split(/\s+/)[0] ?? '';

  // Skip filler / personal titles.
  const lowered = t.toLowerCase();
  if (FILLER_TITLES.has(lowered)) return { name: null, confidence: 0 };

  const stripOwner = (n: string): string => {
    if (!ownerNorm) return n;
    return n
      .split(/\s+/)
      .filter((w) => w.toLowerCase() !== ownerNorm)
      .join(' ')
      .trim();
  };

  // "1:1 with X", "Coffee w/ X", "Catch up — X", "Lunch with X"
  let m = t.match(/^(?:1:1|coffee|catch[ -]?up|lunch|chat|drinks?|breakfast|dinner|tea)\s*(?:w(?:ith)?\.?|with|—|-|–|:)?\s+(.+)$/i);
  if (m && m[1]) return { name: stripOwner(m[1].trim()), confidence: 0.85 };

  // "X @ Org" → counterpart is X.
  m = t.match(/^([^@]+?)\s+@\s+.+$/);
  if (m && m[1]) {
    const c = stripOwner(m[1].trim());
    if (c) return { name: c, confidence: 0.85 };
  }

  // "X / Y" or "X<>Y" or "X — Y" or "X - Y" — pick the side that isn't the user.
  m = t.match(/^(.+?)\s*(?:[/<>]+|\s—\s|\s–\s|\s-\s)\s*(.+)$/);
  if (m && m[1] && m[2]) {
    const left = m[1].trim();
    const right = m[2].trim();
    const leftHasOwner = ownerNorm && left.toLowerCase().includes(ownerNorm);
    const rightHasOwner = ownerNorm && right.toLowerCase().includes(ownerNorm);
    if (leftHasOwner && !rightHasOwner) return { name: right, confidence: 0.8 };
    if (rightHasOwner && !leftHasOwner) return { name: left, confidence: 0.8 };
    // If neither side mentions the user, treat the right side as topic and
    // use the left as the counterpart only when it looks like a proper name.
    if (!leftHasOwner && !rightHasOwner && /^[A-Z][a-z]+(?:\s[A-Z][a-z]+)?$/.test(left)) {
      return { name: left, confidence: 0.7 };
    }
  }

  // "X Call|Chat|Meeting" → X is the counterpart.
  m = t.match(/^([A-Z][A-Za-z'\-.]+(?:\s+[A-Z][A-Za-z'\-.]+)?)\s+(?:call|chat|meeting|interview|intro|catch[ -]?up)$/i);
  if (m && m[1]) {
    const c = stripOwner(m[1].trim());
    if (c) return { name: c, confidence: 0.85 };
  }

  // Bare proper-name title ("Rihki", "Gabriel Sherman", "Justin Shenk").
  // Allow up to three capitalized tokens.
  m = t.match(/^([A-Z][A-Za-z'\-.]{1,}(?:\s+[A-Z][A-Za-z'\-.]+){0,2})$/);
  if (m && m[1]) {
    return { name: stripOwner(m[1].trim()), confidence: 0.7 };
  }

  return { name: null, confidence: 0 };
}

// Group signal: words that strongly imply a multi-person meeting.
const GROUP_HINTS = /\b(standup|stand-up|all[- ]hands|all[- ]team|team\s|kickoff|kick[- ]off|cohort|class|course|workshop|hangout|coliving|community|unconference|happy\s?hour|mixer|group|panel|round[- ]?table|seminar|club)\b/i;

function titleSignalsGroup(title: string | null | undefined): boolean {
  return GROUP_HINTS.test(title ?? '');
}

// Speaker-count signal from the Granola transcript turns. Two distinct
// diarization labels = 1:1 (you + them); 3+ = group.
export function speakerCount(turns: GranolaTranscriptTurn[] | null | undefined): number {
  if (!turns || turns.length === 0) return 0;
  const labels = new Set<string>();
  for (const turn of turns) {
    const lbl =
      turn.speaker?.diarization_label ?? turn.speaker?.source ?? null;
    if (lbl) labels.add(lbl.toLowerCase());
  }
  return labels.size;
}

export interface VoteInput {
  noteTitle: string | null;
  noteSummary?: string | null;
  ownerName?: string | null;
  transcriptTurns?: GranolaTranscriptTurn[] | null;
  attendees?: Array<{ email: string | null; name: string | null }>;
}

// Combine the three signals (title, speaker count, ICS attendees) into a
// single classification + confidence + counterpart name. No LLM call.
export function voteClassification(input: VoteInput): VoteResult {
  const reasons: string[] = [];
  let oneOnOneVotes = 0;
  let groupVotes = 0;
  let counterpartName: string | null = null;
  let counterpartConfidence = 0;

  // Signal 1: title-pattern counterpart extraction.
  const titleVote = extractCounterpartFromTitle(input.noteTitle, input.ownerName);
  if (titleVote.name && titleVote.confidence >= 0.7) {
    oneOnOneVotes++;
    counterpartName = titleVote.name;
    counterpartConfidence = titleVote.confidence;
    reasons.push(`title→"${titleVote.name}"`);
  } else if (titleSignalsGroup(input.noteTitle)) {
    groupVotes++;
    reasons.push('title hints group');
  }

  // Signal 2: transcript speaker count.
  const sc = speakerCount(input.transcriptTurns);
  if (sc === 2) {
    oneOnOneVotes++;
    reasons.push('2 distinct speakers');
  } else if (sc >= 3) {
    groupVotes++;
    reasons.push(`${sc} distinct speakers`);
  }

  // Signal 3: ICS attendees (already pre-filtered to non-self in caller).
  if (input.attendees && input.attendees.length === 1) {
    oneOnOneVotes++;
    if (!counterpartName) {
      const a = input.attendees[0]!;
      counterpartName = a.name ?? a.email ?? null;
      counterpartConfidence = 0.95;
    }
    reasons.push('1 calendar attendee');
  } else if (input.attendees && input.attendees.length > 1) {
    groupVotes++;
    reasons.push(`${input.attendees.length} calendar attendees`);
  }

  // Decision rules.
  if (oneOnOneVotes >= 2 && groupVotes === 0 && counterpartName) {
    return {
      classification: '1:1',
      confidence: Math.min(0.95, counterpartConfidence + 0.1),
      counterpartName,
      reason: reasons.join('; '),
    };
  }
  if (groupVotes >= 2 && oneOnOneVotes === 0) {
    return {
      classification: 'group',
      confidence: 0.8,
      counterpartName: null,
      reason: reasons.join('; '),
    };
  }
  // Single strong signal still gets through with lower confidence.
  if (oneOnOneVotes === 1 && groupVotes === 0 && counterpartName && counterpartConfidence >= 0.85) {
    return {
      classification: '1:1',
      confidence: counterpartConfidence,
      counterpartName,
      reason: reasons.join('; ') || 'title only',
    };
  }
  return {
    classification: 'ambiguous',
    confidence: 0,
    counterpartName,
    reason: reasons.join('; ') || 'no signals',
  };
}
