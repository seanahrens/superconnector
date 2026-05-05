// Load the live "wants" for a person from the signals table.
//
// Signals are the source of truth; people.wants is a presentational rollup.
// "Active" means non-superseded want signals; we expose `created_at` and
// `last_validated_at` so callers (matcher prompts, UI) can reason about
// recency themselves — no decay math, no half-lives.

import type { Env } from '../../worker-configuration';
import type { Evidence } from './db';

export interface ActiveWant {
  id: string;
  body: string;
  evidence: Evidence | null;
  source_span: string | null;
  meeting_id: string | null;
  /** When the underlying want was first captured. */
  created_at: string;
  /** When the want was most recently affirmed by an echo from a later
   *  meeting. Equals `created_at` when never echoed. */
  last_validated_at: string;
}

/** Active (non-superseded) want signals for a person, freshest-validated
 *  first. The matcher and UI can use these directly; consumers that need
 *  a single string still read people.wants. */
export async function loadActiveWants(
  env: Env,
  personId: string,
  limit: number = 30,
): Promise<ActiveWant[]> {
  const res = await env.DB.prepare(
    `SELECT id, body, evidence, source_span, meeting_id,
            created_at, last_validated_at
       FROM signals
      WHERE person_id = ?1
        AND kind = 'want'
        AND superseded_by IS NULL
      ORDER BY COALESCE(last_validated_at, created_at) DESC
      LIMIT ?2`,
  ).bind(personId, limit).all<{
    id: string;
    body: string;
    evidence: string | null;
    source_span: string | null;
    meeting_id: string | null;
    created_at: string;
    last_validated_at: string | null;
  }>();
  return (res.results ?? []).map((r) => ({
    id: r.id,
    body: r.body,
    evidence: (r.evidence as Evidence | null) ?? null,
    source_span: r.source_span,
    meeting_id: r.meeting_id,
    created_at: r.created_at,
    last_validated_at: r.last_validated_at ?? r.created_at,
  }));
}

/** Compact serialization of one want for embedding in an LLM prompt.
 *  The LLM gets `body`, evidence, and the dates — currency judgement
 *  happens inside the model rather than via decay math we'd have to tune. */
export function wantForPrompt(w: ActiveWant): {
  id: string;
  body: string;
  evidence: Evidence | null;
  source_span: string | null;
  created_at: string;
  last_validated_at: string;
} {
  return {
    id: w.id,
    body: w.body,
    evidence: w.evidence,
    source_span: w.source_span,
    created_at: w.created_at,
    last_validated_at: w.last_validated_at,
  };
}
