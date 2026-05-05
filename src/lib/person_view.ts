// Loaders for the rich, denormalized "what we know about this person" view
// shared by plays, the API, and the chat tools.

import type { Env } from '../../worker-configuration';
import type { PersonRow, MeetingRow, SignalRow, FollowupRow } from './db';
import { parseJsonArray, parseJsonObject } from './db';
import { getPersonById } from './people_repo';

export interface PersonView {
  person: PersonRow;
  roles: string[];
  trajectoryTags: string[];
  status: Record<string, unknown>;
  aliases: string[];
  tags: string[];
  recentMeetings: MeetingRow[];
  recentSignals: SignalRow[];
  openFollowups: FollowupRow[];
  closedFollowups: FollowupRow[];
}

export async function loadPersonView(
  env: Env,
  personId: string,
  options: { meetingsLimit?: number; signalsLimit?: number } = {},
): Promise<PersonView | null> {
  const person = await getPersonById(env, personId);
  if (!person) return null;

  const tagsRes = await env.DB.prepare(
    `SELECT t.name FROM tags t
     JOIN person_tags pt ON pt.tag_id = t.id
     WHERE pt.person_id = ?1`,
  ).bind(personId).all<{ name: string }>();

  const meetingsRes = await env.DB.prepare(
    `SELECT * FROM meetings WHERE person_id = ?1 ORDER BY recorded_at DESC LIMIT ?2`,
  ).bind(personId, options.meetingsLimit ?? 5).all<MeetingRow>();

  const signalsRes = await env.DB.prepare(
    `SELECT * FROM signals WHERE person_id = ?1 AND superseded_by IS NULL
     ORDER BY created_at DESC LIMIT ?2`,
  ).bind(personId, options.signalsLimit ?? 30).all<SignalRow>();

  const followupsRes = await env.DB.prepare(
    `SELECT * FROM followups WHERE person_id = ?1 AND status = 'open' ORDER BY due_date NULLS LAST, created_at`,
  ).bind(personId).all<FollowupRow>();

  const closedFollowupsRes = await env.DB.prepare(
    `SELECT * FROM followups
       WHERE person_id = ?1 AND status IN ('done', 'dropped')
       ORDER BY completed_at DESC NULLS LAST, created_at DESC
       LIMIT 50`,
  ).bind(personId).all<FollowupRow>();

  return {
    person,
    roles: parseJsonArray(person.roles),
    trajectoryTags: parseJsonArray(person.trajectory_tags),
    status: parseJsonObject(person.status),
    aliases: parseJsonArray(person.aliases),
    tags: (tagsRes.results ?? []).map((r) => r.name),
    recentMeetings: meetingsRes.results ?? [],
    recentSignals: signalsRes.results ?? [],
    openFollowups: followupsRes.results ?? [],
    closedFollowups: closedFollowupsRes.results ?? [],
  };
}

// Compact serialization suitable for an LLM system prompt.
export function summarizePersonForPrompt(view: PersonView): string {
  const { person, roles, trajectoryTags, tags, recentSignals, openFollowups } = view;
  const lines: string[] = [];
  if (person.degree === 0) {
    lines.push(`This is YOU (the CRM owner, degree=0).`);
  }
  lines.push(`Name: ${person.display_name ?? '(unknown)'}`);
  if (person.primary_email) lines.push(`Email: ${person.primary_email}`);
  if (person.degree !== 0) {
    const degreeLabel = person.degree === 1 ? '1 (direct connection)' : person.degree === 2 ? '2 (needs intro)' : String(person.degree);
    lines.push(`Connection degree: ${degreeLabel}`);
  }
  if (roles.length) lines.push(`Roles: ${roles.join(', ')}`);
  if (trajectoryTags.length) lines.push(`Trajectory: ${trajectoryTags.join(', ')}`);
  if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
  if (person.geo) lines.push(`Geo: ${person.geo}`);
  if (person.last_met_date) lines.push(`Last met: ${person.last_met_date}`);
  if (person.context) lines.push(`\nContext:\n${person.context}`);
  if (person.wants) lines.push(`\nWants:\n${person.wants}`);
  if (recentSignals.length) {
    lines.push(`\nRecent signals:`);
    for (const s of recentSignals.slice(0, 12)) {
      const ev = s.evidence ? `[${s.evidence}]` : '[—]';
      const stamp = s.last_validated_at && s.last_validated_at !== s.created_at
        ? ` (revalidated ${s.last_validated_at.slice(0, 10)})`
        : '';
      lines.push(`- ${s.kind} ${ev}${stamp}: ${s.body}`);
    }
  }
  if (openFollowups.length) {
    lines.push(`\nOpen followups:`);
    for (const f of openFollowups) {
      lines.push(`- ${f.body}${f.due_date ? ` (due ${f.due_date})` : ''}`);
    }
  }
  return lines.join('\n');
}
