// Mirror of the Worker API's JSON shapes.

export interface PersonListItem {
  person_id: string;
  display_name: string | null;
  email: string | null;
  roles: string[];
  trajectory_tags: string[];
  tags: string[];
  last_met_date: string | null;
  meeting_count: number;
  custom_sort_position: string | null;
}

export interface PersonView {
  person: {
    id: string;
    display_name: string | null;
    primary_email: string | null;
    geo: string | null;
    context: string | null;
    needs: string | null;
    offers: string | null;
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
    created_at: string;
    updated_at: string;
  };
  roles: string[];
  trajectoryTags: string[];
  status: Record<string, unknown>;
  aliases: string[];
  tags: string[];
  recentMeetings: Array<{
    id: string;
    person_id: string;
    source: string;
    recorded_at: string;
    summary: string | null;
    transcript: string | null;
    classification: string;
  }>;
  recentSignals: Array<{
    id: string;
    kind: string;
    body: string;
    confidence: number | null;
    meeting_id: string | null;
    created_at: string;
  }>;
  openFollowups: Array<{
    id: string;
    body: string;
    due_date: string | null;
    status: string;
    created_at: string;
    completed_at?: string | null;
  }>;
  closedFollowups: Array<{
    id: string;
    body: string;
    due_date: string | null;
    status: string;
    created_at: string;
    completed_at?: string | null;
  }>;
}

export interface ConfirmationItem {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  payload: unknown;
}

export interface TagRow {
  id: string;
  name: string;
  category: string | null;
  use_count: number;
  created_at: string;
}

export interface TagProposal {
  id: string;
  proposed_name: string;
  proposed_category: string | null;
  example_person_ids: string | null;
  status: string;
  created_at: string;
}

export interface FollowupItem {
  id: string;
  person_id: string;
  display_name: string | null;
  body: string;
  due_date: string | null;
  status: string;
  created_at: string;
}

export interface ChatThread {
  id: string;
  scope: 'global' | 'person';
  person_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls: string | null;
  created_at: string;
}
