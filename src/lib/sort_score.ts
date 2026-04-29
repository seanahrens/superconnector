// "Magical" sort: blend of recency × frequency × custom_position.

const W_RECENCY = 1.0;
const W_FREQUENCY = 0.6;
const W_CUSTOM = 0.4;
const RECENCY_HALF_LIFE_DAYS = 30;

export function sortScore(opts: {
  lastMetDate: string | null;
  meetingCount: number;
  customSortPosition: string | null;
  now?: Date;
}): number {
  const now = opts.now ?? new Date();
  const recency = opts.lastMetDate
    ? Math.exp(-deltaDays(now, opts.lastMetDate) / RECENCY_HALF_LIFE_DAYS)
    : 0;
  const frequency = Math.log(1 + Math.max(0, opts.meetingCount));
  const positionWeight = opts.customSortPosition ? 1 / (1 + customRank(opts.customSortPosition)) : 0;
  return W_RECENCY * recency + W_FREQUENCY * frequency + W_CUSTOM * positionWeight;
}

function deltaDays(now: Date, isoDate: string): number {
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return 365;
  return Math.max(0, (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
}

function customRank(pos: string): number {
  // Approximate ordinal: lower lex string → smaller number → higher weight.
  // Use first 4 chars for a stable, bounded number.
  let n = 0;
  for (let i = 0; i < Math.min(pos.length, 4); i++) {
    n = n * 36 + charValue(pos[i]!);
  }
  return n;
}

function charValue(c: string): number {
  const code = c.charCodeAt(0);
  if (code >= 48 && code <= 57) return code - 48;       // 0-9
  if (code >= 97 && code <= 122) return 10 + code - 97; // a-z
  return 0;
}
