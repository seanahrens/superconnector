// Typed row shapes mirroring the SQL schema. JSON columns stay as strings here;
// callers parse/serialize at the boundaries to keep this layer thin.

export interface PersonRow {
  id: string;
  primary_email: string | null;
  display_name: string | null;
  aliases: string | null;
  roles: string | null;
  trajectory_tags: string | null;
  status: string | null;
  geo: string | null;
  context: string | null;
  wants: string | null;
  last_met_date: string | null;
  follow_up_due_date: string | null;
  meeting_count: number;
  custom_sort_position: string | null;
  context_manual_override: number;
  avatar_url: string | null;
  avatar_source: string | null;
  phone: string | null;
  home_location: string | null;
  work_location: string | null;
  work_org: string | null;
  // Connection degree: 0 = you, 1 = direct (default), 2 = needs intro.
  degree: number;
  created_at: string;
  updated_at: string;
}

export interface MeetingRow {
  id: string;
  person_id: string;
  source: string;
  source_ref: string | null;
  recorded_at: string;
  meeting_context: string | null;
  calendar_match_confidence: number | null;
  event_title: string | null;
  event_start: string | null;
  event_end: string | null;
  attendees_at_match: string | null;
  transcript: string | null;
  summary: string | null;
  classification: string;
  created_at: string;
}

/** Categorical evidence type for an extracted signal. Replaces the previous
 *  free-floating `confidence` float, which the LLM never calibrated and
 *  bunched at 0.85–0.95. `explicit` requires a verbatim quote in
 *  `source_span`; `inferred` is derived from surrounding context;
 *  `weak` is mentioned in passing or hedged. */
export type Evidence = 'explicit' | 'inferred' | 'weak';

/** Allowed `kind` values for a signal row. The old `'need'`/`'offer'` split
 *  collapsed into `'want'`; everything else is unchanged. */
export type SignalKind = 'want' | 'status_change' | 'commitment' | 'note';

export interface SignalRow {
  id: string;
  person_id: string;
  meeting_id: string | null;
  kind: string;
  body: string;
  evidence: string | null;
  source_span: string | null;
  superseded_by: string | null;
  created_at: string;
  last_validated_at: string | null;
}

export interface TagRow {
  id: string;
  name: string;
  category: string | null;
  created_at: string;
}

export interface ConfirmationQueueRow {
  id: string;
  kind: string;
  payload: string;
  status: string;
  created_at: string;
}

export interface FollowupRow {
  id: string;
  person_id: string;
  meeting_id: string | null;
  body: string;
  due_date: string | null;
  status: string;
  created_at: string;
  completed_at: string | null;
}

export interface ChatThreadRow {
  id: string;
  scope: string;
  person_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageRow {
  id: string;
  thread_id: string;
  role: string;
  content: string | null;
  tool_calls: string | null;
  created_at: string;
}

/** Lightweight attendee shape passed around the ingest + classify + queue
 *  paths. Keep this in sync with the JSON we serialize into meetings.attendees
 *  and the queue payload. */
export interface AttendeeRef {
  email: string | null;
  name: string | null;
}

export function parseJsonArray(s: string | null): string[] {
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parseJsonObject<T = Record<string, unknown>>(s: string | null): T {
  if (!s) return {} as T;
  try {
    const parsed = JSON.parse(s);
    return (parsed && typeof parsed === 'object' ? parsed : {}) as T;
  } catch {
    return {} as T;
  }
}

/** Union-merge two string lists, preserving order, deduping, dropping
 *  empty strings. Used everywhere we merge roles / trajectory_tags /
 *  aliases between an existing row and incoming input. */
export function mergeStringArray(
  existing: string[],
  incoming: string[] | undefined | null,
): string[] {
  if (!incoming || incoming.length === 0) return existing;
  const set = new Set(existing);
  for (const x of incoming) if (x) set.add(x);
  return [...set];
}

/** Dedupe while preserving order. Drops empty strings. */
export function uniqStrings(xs: string[]): string[] {
  return [...new Set(xs.filter(Boolean))];
}

/** Build a `?1,?2,?3,…?N` placeholder string for SQL `IN (...)` clauses.
 *  Use with `.bind(...ids)`. Empty input returns the empty string — the
 *  caller is responsible for short-circuiting before composing the SQL. */
export function sqlPlaceholders(ids: ReadonlyArray<unknown>): string {
  return ids.map((_, i) => `?${i + 1}`).join(',');
}
