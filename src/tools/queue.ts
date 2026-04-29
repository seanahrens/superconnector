import type { Tool } from './types';
import type { ConfirmationQueueRow } from '../lib/db';

interface ListInput {
  status?: 'pending' | 'resolved' | 'dismissed';
  kind?: string;
  limit?: number;
}

interface ListOutput {
  items: Array<{
    id: string;
    kind: string;
    status: string;
    created_at: string;
    payload: unknown;
  }>;
}

export const listPendingConfirmationsTool: Tool<ListInput, ListOutput> = {
  name: 'list_pending_confirmations',
  description: 'List items in the confirmation queue (person resolutions, classifications, extraction reviews).',
  inputSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: ['pending', 'resolved', 'dismissed'] },
      kind: { type: 'string' },
      limit: { type: 'number' },
    },
    additionalProperties: false,
  },
  async handler(env, input) {
    const status = input.status ?? 'pending';
    const limit = input.limit ?? 25;
    const sql = input.kind
      ? `SELECT * FROM confirmation_queue WHERE status = ?1 AND kind = ?2 ORDER BY created_at LIMIT ?3`
      : `SELECT * FROM confirmation_queue WHERE status = ?1 ORDER BY created_at LIMIT ?2`;
    const stmt = input.kind
      ? env.DB.prepare(sql).bind(status, input.kind, limit)
      : env.DB.prepare(sql).bind(status, limit);
    const res = await stmt.all<ConfirmationQueueRow>();
    return {
      items: (res.results ?? []).map((r) => ({
        id: r.id,
        kind: r.kind,
        status: r.status,
        created_at: r.created_at,
        payload: safeParse(r.payload),
      })),
    };
  },
};

interface ResolveInput {
  id: string;
  decision: 'resolve' | 'dismiss';
  // For person_resolution: pick a candidate or create a new person.
  selected_person_id?: string;
  // For meeting_classification: explicit classification.
  classification?: '1:1' | 'group' | 'ambiguous';
  // For extraction_review: accept/reject the parked diff.
  accept_extraction?: boolean;
}

export const resolveConfirmationTool: Tool<ResolveInput, { ok: true }> = {
  name: 'resolve_confirmation',
  description:
    'Resolve a confirmation queue item. The optional fields apply per kind: selected_person_id for person_resolution, classification for meeting_classification, accept_extraction for extraction_review.',
  inputSchema: {
    type: 'object',
    properties: {
      id: { type: 'string' },
      decision: { type: 'string', enum: ['resolve', 'dismiss'] },
      selected_person_id: { type: 'string' },
      classification: { type: 'string', enum: ['1:1', 'group', 'ambiguous'] },
      accept_extraction: { type: 'boolean' },
    },
    required: ['id', 'decision'],
    additionalProperties: false,
  },
  async handler(env, input) {
    // The actual side-effects (creating a meeting from a resolved classification,
    // applying a parked extraction) live in the API layer's resolveQueueItem helper
    // so we keep this tool surface declarative; here we just update the row.
    const next = input.decision === 'resolve' ? 'resolved' : 'dismissed';
    await env.DB.prepare(
      'UPDATE confirmation_queue SET status = ?1 WHERE id = ?2',
    ).bind(next, input.id).run();
    return { ok: true } as const;
  },
};

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
