import type { Env } from '../../worker-configuration';

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
  const result = await env.VECTORS.query(values, { topK, returnMetadata: 'all' });
  return result.matches
    .map((m) => ({ personId: String(m.metadata?.person_id ?? m.id), score: m.score }))
    .filter((m) => m.personId !== excludePersonId);
}

// Hash-gate re-embedding: returns true if the source text changed since the last
// embedding for this person (tracked outside this function — caller compares hashes).
export async function hashContext(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
