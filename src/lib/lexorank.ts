// Tiny fractional indexing for drag-and-drop ordering. Generates a string key
// strictly between two existing keys. Single-user scale, so we don't need
// rebalancing.
//
// Alphabet: 0-9 a-z, 36 chars. Comparison is lexicographic.

const ALPHA = '0123456789abcdefghijklmnopqrstuvwxyz';
const FIRST = '0';
const LAST = 'z';

export function between(prev: string | null, next: string | null): string {
  const a = prev ?? '';
  const b = next ?? '';
  let i = 0;
  // Walk shared prefix.
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  let prefix = a.slice(0, i);
  const ca = a[i] ?? FIRST;
  const cb = b[i] ?? LAST;
  if (a === '' && b === '') return 'm';

  // If b runs out (or there's no upper bound past prefix), append a midpoint.
  if (i >= b.length || ca === cb) {
    // Just produce a key strictly greater than a by extending it.
    return appendMidpoint(prefix, ca, ca);
  }

  // ca < cb (after shared prefix). Try midpoint of (ca+1, cb).
  const aIdx = ALPHA.indexOf(ca);
  const bIdx = ALPHA.indexOf(cb);
  if (aIdx === -1 || bIdx === -1) throw new Error('invalid lexorank chars');
  if (bIdx - aIdx > 1) {
    const mid = Math.floor((aIdx + bIdx) / 2);
    return prefix + ALPHA[mid];
  }
  // Adjacent. Keep ca and append between (rest of a, FIRST..LAST).
  prefix = prefix + ca;
  const aRest = a.slice(i + 1);
  return between(aRest === '' ? null : aRest, null).length === 0
    ? prefix + 'm'
    : prefix + appendMidpoint('', aRest[0] ?? FIRST, FIRST);
}

function appendMidpoint(prefix: string, lo: string, _hi: string): string {
  const loIdx = Math.max(0, ALPHA.indexOf(lo));
  // Append a char between lo and LAST.
  const hiIdx = ALPHA.length - 1;
  const mid = Math.floor((loIdx + hiIdx) / 2);
  return prefix + ALPHA[mid];
}
