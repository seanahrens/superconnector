import type { Env } from '../../worker-configuration';
import { sqlPlaceholders } from './db';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5'; // 768-dim
const VECTOR_DIM = 768;

export async function embed(env: Env, text: string): Promise<number[]> {
  const result = (await env.AI.run(EMBED_MODEL, { text: [text] })) as {
    data: number[][];
  };
  const v = result.data[0];
  if (!v || v.length !== VECTOR_DIM) {
    throw new Error(`embedding returned wrong shape: ${v?.length ?? 'null'}`);
  }
  return v;
}

export async function upsertPersonVector(
  env: Env,
  personId: string,
  text: string,
): Promise<void> {
  const values = await embed(env, text);
  await env.VECTORS.upsert([
    {
      id: personId,
      values,
      metadata: { person_id: personId, last_embedded_at: new Date().toISOString() },
    },
  ]);
}

export interface VectorMatch {
  personId: string;
  score: number;
}

export async function querySimilarPeople(
  env: Env,
  text: string,
  topK: number = 20,
  excludePersonId?: string,
): Promise<VectorMatch[]> {
  const values = await embed(env, text);
  // Pull a wider window so we can drop You (degree=0) and the explicit
  // exclude without starving downstream rankers.
  const result = await env.VECTORS.query(values, { topK: topK + 4, returnMetadata: 'all' });
  const raw = result.matches.map((m) => ({
    personId: String(m.metadata?.person_id ?? m.id),
    score: m.score,
  }));
  const filtered = raw.filter((m) => m.personId !== excludePersonId);
  if (filtered.length === 0) return filtered;
  // Drop the user's own row — they're never a candidate to introduce themselves to.
  const meRows = await env.DB.prepare(
    `SELECT id FROM people WHERE id IN (${sqlPlaceholders(filtered)}) AND degree = 0`,
  ).bind(...filtered.map((f) => f.personId)).all<{ id: string }>();
  const meIds = new Set((meRows.results ?? []).map((r) => r.id));
  return filtered.filter((m) => !meIds.has(m.personId)).slice(0, topK);
}

// Hash-gate re-embedding: returns true if the source text changed since the last
// embedding for this person (tracked outside this function — caller compares hashes).
export async function hashContext(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
