import type { Tool } from './types';
import { ulid, nowIso } from '../lib/ulid';

export const addFollowupTool: Tool<
  { person_id: string; body: string; due_date?: string },
  { id: string }
> = {
  name: 'add_followup',
  description: 'Record an open commitment ("I will intro X to Y" / "send Z the deck").',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string' },
      body: { type: 'string' },
      due_date: { type: 'string', description: 'ISO date (YYYY-MM-DD), optional.' },
    },
    required: ['person_id', 'body'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const id = ulid();
    await env.DB.prepare(
      `INSERT INTO followups (id, person_id, meeting_id, body, due_date, status, created_at)
       VALUES (?1, ?2, NULL, ?3, ?4, 'open', ?5)`,
    ).bind(id, input.person_id, input.body, input.due_date ?? null, nowIso()).run();
    return { id };
  },
};

export const completeFollowupTool: Tool<
  { id: string; status: 'done' | 'dropped' | 'open' },
  { ok: true }
> = {
  name: 'complete_followup',
  description: 'Mark a followup as done, dropped, or re-open it ("uncomplete").',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      status: { type: 'string', enum: ['done', 'dropped', 'open'] },
    },
    required: ['id', 'status'],
    additionalProperties: false,
  },
  async handler(env, input) {
    // When re-opening, clear the completed_at timestamp.
    const completedAt = input.status === 'open' ? null : nowIso();
    await env.DB.prepare(
      `UPDATE followups SET status = ?1, completed_at = ?2 WHERE id = ?3`,
    ).bind(input.status, completedAt, input.id).run();
    return { ok: true } as const;
  },
};
