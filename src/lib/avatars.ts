// Resolve an avatar URL for a person, preferring real photos before
// falling through to a deterministic initials avatar.
//
// Cascade:
//   1. Gravatar (MD5 of trimmed lowercased email; d=404 means "no account").
//   2. DiceBear initials avatar (always works, deterministic per name/id).
//
// LinkedIn / X / etc. would require auth and TOS-iffy scraping; intentionally
// out of scope.

import type { Env } from '../../worker-configuration';
import { nowIso } from './ulid';

export interface ResolvedAvatar {
  url: string;
  source: 'gravatar' | 'dicebear';
}

export async function resolveAvatar(
  email: string | null | undefined,
  displayName: string | null | undefined,
  personId: string,
): Promise<ResolvedAvatar> {
  const trimmed = (email ?? '').trim().toLowerCase();
  if (trimmed) {
    const hash = await md5Hex(trimmed);
    const url = `https://www.gravatar.com/avatar/${hash}?s=128&d=404`;
    try {
      const head = await fetch(url, { method: 'HEAD' });
      if (head.ok) return { url: `https://www.gravatar.com/avatar/${hash}?s=128`, source: 'gravatar' };
    } catch {
      // Network blip — fall through.
    }
  }

  // DiceBear initials avatar — seeded by name (preferred) or id.
  const seed = encodeURIComponent((displayName?.trim() || personId).slice(0, 64));
  return {
    url: `https://api.dicebear.com/9.x/initials/svg?seed=${seed}`,
    source: 'dicebear',
  };
}

// Fetches and caches the resolved avatar on the person row. Idempotent —
// once a non-dicebear source is found, future calls reuse it. Dicebear
// stays as the deterministic fallback so a person with no email never
// flickers.
export async function resolveAndCacheAvatar(env: Env, personId: string): Promise<ResolvedAvatar> {
  const row = await env.DB.prepare(
    'SELECT primary_email, display_name, avatar_url, avatar_source FROM people WHERE id = ?1',
  ).bind(personId).first<{
    primary_email: string | null;
    display_name: string | null;
    avatar_url: string | null;
    avatar_source: string | null;
  }>();
  if (!row) throw new Error('person not found');

  // Reuse a real photo if we already have one. Don't re-cache dicebear so
  // we'll re-attempt gravatar if the user later adds an email.
  if (row.avatar_url && row.avatar_source && row.avatar_source !== 'dicebear') {
    return { url: row.avatar_url, source: row.avatar_source as 'gravatar' };
  }

  const resolved = await resolveAvatar(row.primary_email, row.display_name, personId);
  await env.DB.prepare(
    'UPDATE people SET avatar_url = ?1, avatar_source = ?2, updated_at = ?3 WHERE id = ?4',
  ).bind(resolved.url, resolved.source, nowIso(), personId).run();
  return resolved;
}

// Quick MD5 in pure JS (no Web Crypto MD5). Granola-tier perf is fine.
async function md5Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  return md5(bytes);
}

// Standard MD5 — RFC 1321 reference implementation. ~80 lines, no deps.
function md5(input: Uint8Array): string {
  const r = new Uint8Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]);
  const k = new Int32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);

  // Pre-processing: pad message.
  const msgLen = input.length;
  const totalLen = ((msgLen + 8) >>> 6) * 64 + 64;
  const padded = new Uint8Array(totalLen);
  padded.set(input);
  padded[msgLen] = 0x80;
  const bitLen = BigInt(msgLen) * 8n;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, Number(bitLen & 0xffffffffn), true);
  view.setUint32(totalLen - 4, Number((bitLen >> 32n) & 0xffffffffn), true);

  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;

  for (let off = 0; off < totalLen; off += 64) {
    const m = new Int32Array(16);
    for (let i = 0; i < 16; i++) m[i] = view.getInt32(off + i * 4, true);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f = 0, g = 0;
      if (i < 16) { f = (b & c) | ((~b) & d); g = i; }
      else if (i < 32) { f = (d & b) | ((~d) & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | (~d)); g = (7 * i) % 16; }
      const temp = d;
      d = c;
      c = b;
      const sum = (a + f + k[i]! + m[g]!) | 0;
      b = (b + leftRotate(sum, r[i]!)) | 0;
      a = temp;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0].map(toHexLE).join('');
}

function leftRotate(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) | 0;
}
function toHexLE(n: number): string {
  return [0, 8, 16, 24]
    .map((s) => ((n >>> s) & 0xff).toString(16).padStart(2, '0'))
    .join('');
}
