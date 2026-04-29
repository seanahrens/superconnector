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
  needs: string | null;
  offers: string | null;
  last_met_date: string | null;
  follow_up_due_date: string | null;
  meeting_count: number;
  custom_sort_position: string | null;
  context_manual_override: number;
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

export interface SignalRow {
  id: string;
  person_id: string;
  meeting_id: string | null;
  kind: string;
  body: string;
  confidence: number | null;
  superseded_by: string | null;
  created_at: string;
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
