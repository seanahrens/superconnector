import type { Tool } from './types';
import type { PersonRow } from '../lib/db';
import { parseJsonArray, sqlPlaceholders } from '../lib/db';
import { querySimilarPeople } from '../lib/embed';

interface Input {
  query: string;
  limit?: number;
  semantic?: boolean;
  // Default false: search results are typically used for "find me a candidate"
  // flows where You (degree=0) should never appear. Pass true if the caller
  // genuinely needs to look up the user's own profile.
  include_me?: boolean;
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
      include_me: {
        type: 'boolean',
        description: "Include You (the user, degree=0) in results. Default false — almost never needed.",
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const limit = input.limit ?? 10;
    const trimmedQuery = input.query.trim();
    const includeMe = input.include_me === true;
    const dropMe = <T extends { degree: number }>(rows: T[]): T[] =>
      includeMe ? rows : rows.filter((r) => r.degree !== 0);

    if (input.semantic) {
      const matches = await querySimilarPeople(env, trimmedQuery, limit);
      const ids = matches.map((m) => m.personId);
      if (ids.length === 0) return { matches: [] };
      const rows = await env.DB.prepare(
        `SELECT * FROM people WHERE id IN (${sqlPlaceholders(ids)})`,
      ).bind(...ids).all<PersonRow>();
      const kept = dropMe(rows.results ?? []);
      const byId = new Map(kept.map((r) => [r.id, r]));
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
      return { matches: dropMe(found.results ?? []).map(toMatch) };
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
      matches: dropMe(fts.results ?? []).map((r) => ({ ...toMatch(r), snippet: r.snippet })),
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
