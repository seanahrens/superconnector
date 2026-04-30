// Canonical tag-name normalization. Spaces (not underscores) separate
// words; the slash stays as the namespace separator (e.g.
// "trajectory/raising seed"). Lowercased and trimmed; collapsed whitespace.

export function normalizeTagName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
