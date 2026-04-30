// People list (with filters + sort + drag-and-drop reorder), detail, and field
// edits used by the web UI.

import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import type { PersonRow } from '../lib/db';
import { parseJsonArray } from '../lib/db';
import { loadPersonView } from '../lib/person_view';
import { sortScore } from '../lib/sort_score';
import { between } from '../lib/lexorank';
import { nowIso } from '../lib/ulid';
import { runTool } from '../tools';
import { rankMergeCandidates, mergePeople } from '../lib/merge_people';
import { resolveAndCacheAvatar } from '../lib/avatars';

const app = new Hono<{ Bindings: Env }>();

interface ListItem {
  person_id: string;
  display_name: string | null;
  email: string | null;
  roles: string[];
  trajectory_tags: string[];
  tags: string[];
  last_met_date: string | null;
  meeting_count: number;
  custom_sort_position: string | null;
}

app.get('/', async (c) => {
  const url = new URL(c.req.url);
  const sort = url.searchParams.get('sort') ?? 'magical'; // magical | recent | frequent | custom | alpha
  const tagsCsv = url.searchParams.get('tags') ?? '';
  const rolesCsv = url.searchParams.get('roles') ?? '';
  const tagMode = (url.searchParams.get('tag_mode') ?? 'or') as 'and' | 'or';
  const search = url.searchParams.get('q') ?? '';
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 200), 500);
  // The "Me" person — matched by env.EMAIL_TO — is excluded from the list
  // by default. Pass include_me=1 to include them (e.g. for the merge
  // candidate fallback on themselves, though we never want that either).
  const includeMe = url.searchParams.get('include_me') === '1';
  const meEmail = (c.env.EMAIL_TO ?? '').toLowerCase().trim();

  const tags = tagsCsv ? tagsCsv.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const roles = rolesCsv ? rolesCsv.split(',').map((t) => t.trim()).filter(Boolean) : [];

  // Pull a manageable superset, filter+score in JS. Single-user scale → fine.
  const all = await c.env.DB.prepare(
    `SELECT * FROM people LIMIT 5000`,
  ).all<PersonRow>();
  const rows = all.results ?? [];

  // Pre-fetch tag names per person if any tag filter or we want to return tags.
  const personTagMap = await loadTagsForPeople(c.env, rows.map((r) => r.id));

  // Hide phantom rows (no name, no email, zero meetings) from the list view.
  // They can still be accessed by direct id if needed.
  let filtered: PersonRow[] = rows.filter(
    (p) =>
      (p.display_name && p.display_name.trim()) ||
      (p.primary_email && p.primary_email.trim()) ||
      p.meeting_count > 0,
  );
  // Hide the user's own row by default — they have a dedicated profile
  // button in the layout footer.
  if (!includeMe && meEmail) {
    filtered = filtered.filter((p) => (p.primary_email ?? '').toLowerCase() !== meEmail);
  }

  if (search) {
    const needle = search.toLowerCase();
    filtered = filtered.filter((p) => {
      const hay = [p.display_name, p.primary_email, p.context, p.needs, p.offers]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
  }
  if (roles.length) {
    filtered = filtered.filter((p) => {
      const pr = parseJsonArray(p.roles);
      return roles.every((r) => pr.includes(r));
    });
  }
  if (tags.length) {
    filtered = filtered.filter((p) => {
      const pt = personTagMap.get(p.id) ?? [];
      return tagMode === 'and' ? tags.every((t) => pt.includes(t)) : tags.some((t) => pt.includes(t));
    });
  }

  filtered.sort((a, b) => {
    if (sort === 'recent') {
      return cmpDateDesc(a.last_met_date, b.last_met_date);
    }
    if (sort === 'frequent') {
      return b.meeting_count - a.meeting_count;
    }
    if (sort === 'custom') {
      return (a.custom_sort_position ?? 'z').localeCompare(b.custom_sort_position ?? 'z');
    }
    if (sort === 'alpha') {
      // Lowercase compare; rows with no display_name go to the end.
      const an = (a.display_name ?? '').toLowerCase();
      const bn = (b.display_name ?? '').toLowerCase();
      if (!an && !bn) return 0;
      if (!an) return 1;
      if (!bn) return -1;
      return an.localeCompare(bn);
    }
    // magical
    return (
      sortScore({
        lastMetDate: b.last_met_date,
        meetingCount: b.meeting_count,
        customSortPosition: b.custom_sort_position,
      }) -
      sortScore({
        lastMetDate: a.last_met_date,
        meetingCount: a.meeting_count,
        customSortPosition: a.custom_sort_position,
      })
    );
  });

  const items: ListItem[] = filtered.slice(0, limit).map((p) => ({
    person_id: p.id,
    display_name: p.display_name,
    email: p.primary_email,
    roles: parseJsonArray(p.roles),
    trajectory_tags: parseJsonArray(p.trajectory_tags),
    tags: personTagMap.get(p.id) ?? [],
    last_met_date: p.last_met_date,
    meeting_count: p.meeting_count,
    custom_sort_position: p.custom_sort_position,
  }));

  return c.json({ items, total: filtered.length, sort, tag_mode: tagMode });
});

// Resolve the "Me" person id by EMAIL_TO. The dedicated profile button in
// the people layout footer hits this to know where to navigate.
app.get('/me', async (c) => {
  const email = (c.env.EMAIL_TO ?? '').toLowerCase().trim();
  if (!email) return c.json({ error: 'EMAIL_TO not configured' }, 503);
  const row = await c.env.DB.prepare(
    'SELECT id FROM people WHERE primary_email = ?1 LIMIT 1',
  ).bind(email).first<{ id: string }>();
  if (!row) return c.json({ error: 'not found' }, 404);
  return c.json({ person_id: row.id });
});

app.get('/:id', async (c) => {
  const view = await loadPersonView(c.env, c.req.param('id'));
  if (!view) return c.json({ error: 'not found' }, 404);
  return c.json(view);
});

app.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();
  await runTool(c.env, 'update_person', { person_id: id, ...body });
  const view = await loadPersonView(c.env, id);
  return c.json(view);
});

interface ReorderBody {
  before?: string | null;       // person_id immediately before in the new order
  after?: string | null;        // person_id immediately after in the new order
}

app.post('/:id/reorder', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<ReorderBody>();
  const [beforeRow, afterRow] = await Promise.all([
    body.before ? c.env.DB.prepare('SELECT custom_sort_position FROM people WHERE id = ?1').bind(body.before).first<{ custom_sort_position: string | null }>() : null,
    body.after ? c.env.DB.prepare('SELECT custom_sort_position FROM people WHERE id = ?1').bind(body.after).first<{ custom_sort_position: string | null }>() : null,
  ]);
  const newPos = between(beforeRow?.custom_sort_position ?? null, afterRow?.custom_sort_position ?? null);
  await c.env.DB.prepare(
    'UPDATE people SET custom_sort_position = ?1, updated_at = ?2 WHERE id = ?3',
  ).bind(newPos, nowIso(), id).run();
  return c.json({ custom_sort_position: newPos });
});

// Tag mutations on a person are also reachable via the tools layer; keep these
// HTTP-friendly aliases for the SvelteKit app.
app.post('/:id/tags', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ tag_name: string; category?: string }>();
  const out = await runTool(c.env, 'apply_tag', { person_id: id, ...body });
  return c.json(out);
});

app.delete('/:id/tags/:tag_name', async (c) => {
  const id = c.req.param('id');
  const tagName = decodeURIComponent(c.req.param('tag_name'));
  const out = await runTool(c.env, 'remove_tag', { person_id: id, tag_name: tagName });
  return c.json(out);
});

// Lazy avatar resolution. Returns the cached URL when one exists; otherwise
// runs the resolution cascade (Gravatar → DiceBear initials) and caches it.
app.get('/:id/avatar', async (c) => {
  const id = c.req.param('id');
  try {
    const r = await resolveAndCacheAvatar(c.env, id);
    return c.json(r);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// Merge candidates ranked by cheap regex/string heuristics (no LLM in the
// hot path). Returns up to 10 candidates with score + reasons.
app.get('/:id/merge-candidates', async (c) => {
  const id = c.req.param('id');
  const candidates = await rankMergeCandidates(c.env, id);
  const items = candidates.map((s) => ({
    person_id: s.person.id,
    display_name: s.person.display_name,
    primary_email: s.person.primary_email,
    last_met_date: s.person.last_met_date,
    meeting_count: s.person.meeting_count,
    aliases: parseJsonArray(s.person.aliases),
    roles: parseJsonArray(s.person.roles),
    context: s.person.context,
    needs: s.person.needs,
    offers: s.person.offers,
    score: s.score,
    reasons: s.reasons,
  }));
  return c.json({ items });
});

// Perform the merge. The :id is the kept (target) person. Donor is in body.
app.post('/:id/merge', async (c) => {
  const keptId = c.req.param('id');
  const { donor_id } = await c.req.json<{ donor_id: string }>();
  if (!donor_id) return c.json({ error: 'donor_id required' }, 400);
  if (donor_id === keptId) return c.json({ error: 'cannot merge into self' }, 400);
  try {
    const result = await mergePeople(c.env, keptId, donor_id);
    return c.json(result);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

async function loadTagsForPeople(env: Env, ids: string[]): Promise<Map<string, string[]>> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map((_, i) => `?${i + 1}`).join(',');
  const rows = await env.DB.prepare(
    `SELECT pt.person_id, t.name FROM person_tags pt
     JOIN tags t ON t.id = pt.tag_id
     WHERE pt.person_id IN (${placeholders})`,
  ).bind(...ids).all<{ person_id: string; name: string }>();
  const map = new Map<string, string[]>();
  for (const row of rows.results ?? []) {
    if (!map.has(row.person_id)) map.set(row.person_id, []);
    map.get(row.person_id)!.push(row.name);
  }
  return map;
}

function cmpDateDesc(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? 1 : -1;
}

export default app;
