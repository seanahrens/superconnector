import type { Tool } from './types';
import type { PersonRow } from '../lib/db';
import { parseJsonArray } from '../lib/db';
import { querySimilarPeople } from '../lib/embed';

interface Input {
  query: string;
  limit?: number;
  semantic?: boolean;
}

interface Output {
  matches: Array<{
    person_id: string;
    display_name: string | null;
    email: string | null;
    roles: string[];
    last_met_date: string | null;
    score?: number;
    snippet?: string;
  }>;
}

export const searchPeople: Tool<Input, Output> = {
  name: 'search_people',
  description:
    'Search the people graph by name/email/freetext. By default uses FTS5 over name/context/needs/offers; pass semantic=true for vector similarity.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search text.' },
      limit: { type: 'number', description: 'Max results (default 10).' },
      semantic: { type: 'boolean', description: 'Use vector similarity instead of FTS.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const limit = input.limit ?? 10;
    const trimmedQuery = input.query.trim();

    if (input.semantic) {
      const matches = await querySimilarPeople(env, trimmedQuery, limit);
      const ids = matches.map((m) => m.personId);
      if (ids.length === 0) return { matches: [] };
      const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
      const rows = await env.DB.prepare(
        `SELECT * FROM people WHERE id IN (${placeholders})`,
      ).bind(...ids).all<PersonRow>();
      const byId = new Map((rows.results ?? []).map((r) => [r.id, r]));
      return {
        matches: matches.flatMap((m) => {
          const p = byId.get(m.personId);
          if (!p) return [];
          return [{
            person_id: p.id,
            display_name: p.display_name,
            email: p.primary_email,
            roles: parseJsonArray(p.roles),
            last_met_date: p.last_met_date,
            score: m.score,
          }];
        }),
      };
    }

    // FTS path: also fall back to LIKE on email if the query looks like one.
    if (trimmedQuery.includes('@')) {
      const found = await env.DB.prepare(
        'SELECT * FROM people WHERE primary_email LIKE ?1 LIMIT ?2',
      ).bind(`%${trimmedQuery.toLowerCase()}%`, limit).all<PersonRow>();
      return { matches: (found.results ?? []).map(toMatch) };
    }
    const ftsQuery = trimmedQuery
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `${t}*`)
      .join(' ');
    const fts = await env.DB.prepare(
      `SELECT p.*, snippet(people_fts, -1, '[', ']', '…', 16) AS snippet
       FROM people_fts
       JOIN people p ON p.rowid = people_fts.rowid
       WHERE people_fts MATCH ?1
       LIMIT ?2`,
    ).bind(ftsQuery, limit).all<PersonRow & { snippet: string }>();
    return {
      matches: (fts.results ?? []).map((r) => ({ ...toMatch(r), snippet: r.snippet })),
    };
  },
};

function toMatch(p: PersonRow): {
  person_id: string;
  display_name: string | null;
  email: string | null;
  roles: string[];
  last_met_date: string | null;
} {
  return {
    person_id: p.id,
    display_name: p.display_name,
    email: p.primary_email,
    roles: parseJsonArray(p.roles),
    last_met_date: p.last_met_date,
  };
}
