// Crockford-base32 ULID. Monotonic enough at single-user scale; uses crypto.getRandomValues.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

function encodeTime(now: number): string {
  let out = '';
  let t = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    const mod = t % ENCODING_LEN;
    out = ENCODING[mod] + out;
    t = Math.floor(t / ENCODING_LEN);
  }
  return out;
}

function encodeRandom(): string {
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    out += ENCODING[bytes[i]! % ENCODING_LEN];
  }
  return out;
}

export function nowIso(): string {
  return new Date().toISOString();
}
