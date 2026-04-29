import Anthropic from '@anthropic-ai/sdk';
import type { Env } from '../../worker-configuration';

export const MODEL_HAIKU = 'claude-haiku-4-5-20251001';
export const MODEL_SONNET = 'claude-sonnet-4-6';

export function getClient(env: Env): Anthropic {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

// Wrap a long, stable string (extraction guidelines, role pack) so Anthropic
// caches it across calls. Caller passes this as a system message.
export function cached(text: string): {
  type: 'text';
  text: string;
  cache_control: { type: 'ephemeral' };
} {
  return { type: 'text', text, cache_control: { type: 'ephemeral' } };
}

export interface JsonCallOptions {
  model?: string;
  systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>;
  userMessage: string;
  maxTokens?: number;
}

// Calls Claude expecting a single JSON object back. Tolerates fenced ```json blocks.
export async function jsonCall<T>(env: Env, opts: JsonCallOptions): Promise<T> {
  const client = getClient(env);
  const resp = await client.messages.create({
    model: opts.model ?? MODEL_HAIKU,
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.systemBlocks,
    messages: [{ role: 'user', content: opts.userMessage }],
  });

  const text = resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();

  return parseJsonLoose<T>(text);
}

export function parseJsonLoose<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const body = (fenced?.[1] ?? text).trim();
  try {
    return JSON.parse(body) as T;
  } catch (err) {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(body.slice(start, end + 1)) as T;
    }
    throw new Error(`could not parse JSON from model output: ${(err as Error).message}`);
  }
}
