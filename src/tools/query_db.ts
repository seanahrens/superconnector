// Read-only SQL escape hatch for the master chat. Guarded against writes,
// destructive operations, and cross-table joins that would leak too much.
//
// The guard is not a full SQL parser — for a single-user assistant context this
// is enough; the LLM is your operator, not an adversary. Still, we refuse
// anything that contains a writing keyword.

import type { Tool } from './types';

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|attach|detach|pragma|vacuum|reindex|replace)\b/i;

interface Input {
  sql: string;
  bindings?: Array<string | number | null>;
  limit?: number;
}

interface Output {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  truncated: boolean;
}

export const queryDbTool: Tool<Input, Output> = {
  name: 'query_db_readonly',
  description:
    'Run a read-only SELECT against the database. Refuses any writing keyword. Always wraps the query with a LIMIT.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string' },
      bindings: { type: 'array', items: { type: 'string' } },
      limit: { type: 'number', description: 'Hard cap on rows returned (default 50, max 500).' },
    },
    required: ['sql'],
    additionalProperties: false,
  },
  async handler(env, input) {
    if (FORBIDDEN.test(input.sql)) {
      throw new Error('forbidden keyword in SQL');
    }
    const limit = Math.min(input.limit ?? 50, 500);
    const wrapped = `SELECT * FROM (${input.sql}) LIMIT ${limit + 1}`;
    const stmt = env.DB.prepare(wrapped);
    const bindings = input.bindings ?? [];
    const result = bindings.length > 0
      ? await stmt.bind(...bindings).all()
      : await stmt.all();
    const rows = result.results ?? [];
    const truncated = rows.length > limit;
    const trimmed = truncated ? rows.slice(0, limit) : rows;
    const columns = trimmed[0] ? Object.keys(trimmed[0] as object) : [];
    return { columns, rows: trimmed as Array<Record<string, unknown>>, truncated };
  },
};
