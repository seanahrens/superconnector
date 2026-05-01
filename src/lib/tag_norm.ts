// Canonical tag-name normalization. Spaces (not underscores) separate
// words; the slash stays as the namespace separator (e.g.
// "trajectory/raising seed"). Lowercased and trimmed; collapsed whitespace.
//
// Every code path that writes a tag, role, or trajectory tag — whether
// directly to D1 or via a tool call — must run input through one of these
// helpers. Audit list (do not let a write site bypass these):
//   - src/lib/people_writes.ts (applyExtractionResult)
//   - src/tools/people_mut.ts (update_person, add_person)
//   - src/tools/tags.ts (apply_tag, review_tag_proposal)
//   - src/api/tags.ts (PATCH /api/tags/:id)

export function normalizeTagName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize an array of tags/roles/trajectory tags. Drops empties,
 *  dedupes, preserves order. Returns undefined when input was undefined
 *  so callers can use it as an opt-in transform. */
export function normalizeTagArray(arr: string[] | undefined | null): string[] | undefined {
  if (!arr) return undefined;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    if (typeof x !== 'string') continue;
    const norm = normalizeTagName(x);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

/** Canonical LLM-facing rules about tag names. Embed this in any system
 *  prompt that asks the model to produce tags, roles, or trajectory tags
 *  so the rules live in one place and stay consistent across surfaces.
 *  Wrap with `cached(...)` from anthropic.ts so prompt-caching shares it. */
export const TAG_NAMING_RULES = `Tag, role, and trajectory-tag rules:
- Lowercase. Words separated by SPACES, never underscores.
- Slash ("/") is the namespace separator and only allowed for trajectory
  tags (e.g. "trajectory/raising seed"). No slashes in role values.
- Roles are drawn from the canonical set when applicable: founder,
  funder, talent, advisor, researcher, operator, engineer.
- Trajectory tags describe a person's current trajectory (e.g.
  "exploring founding", "open to cofounding", "raising seed"). Keep
  them short (≤ 4 words).
- Free tags are emergent topics/skills. Keep them short and lowercase.
- NEVER emit "snake_case" forms like "open_to_cofounding". The system
  will normalize them silently, but it's noisier signal — write them
  with spaces from the start.`;
