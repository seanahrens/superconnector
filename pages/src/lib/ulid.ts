// Same Crockford-base32 ULID generator as the Worker, for client-generated thread IDs.

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const ENCODING_LEN = 32;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

export function ulid(now: number = Date.now()): string {
  let timeStr = '';
  let t = now;
  for (let i = TIME_LEN - 1; i >= 0; i--) {
    timeStr = ENCODING[t % ENCODING_LEN] + timeStr;
    t = Math.floor(t / ENCODING_LEN);
  }
  const bytes = new Uint8Array(RANDOM_LEN);
  crypto.getRandomValues(bytes);
  let randStr = '';
  for (let i = 0; i < RANDOM_LEN; i++) {
    randStr += ENCODING[bytes[i]! % ENCODING_LEN];
  }
  return timeStr + randStr;
}
