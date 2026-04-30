// add_person, update_person — direct manual mutations bypassing the LLM
// extraction path. Used by the manual-entry form and the chat tools when the
// user wants a precise patch.

import type { Tool } from './types';
import { resolvePerson } from '../lib/resolve';
import { upsertPersonVector } from '../lib/embed';
import { nowIso } from '../lib/ulid';
import type { PersonRow } from '../lib/db';
import { parseJsonArray, parseJsonObject } from '../lib/db';

interface AddInput {
  name?: string;
  email?: string;
  initial_context?: string;
  roles?: string[];
}

export const addPersonTool: Tool<AddInput, { person_id: string; created: boolean }> = {
  name: 'add_person',
  description: 'Create or upsert a person by email/name. Returns the person_id.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string' },
      email: { type: 'string' },
      initial_context: { type: 'string' },
      roles: { type: 'array', items: { type: 'string' } },
    },
    additionalProperties: false,
  },
  async handler(env, input) {
    const r = await resolvePerson(env, { email: input.email, name: input.name });
    if (input.initial_context || input.roles) {
      const existing = await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(r.personId).first<PersonRow>();
      if (existing) {
        const newRoles = mergeArr(parseJsonArray(existing.roles), input.roles);
        const newContext = existing.context_manual_override
          ? existing.context
          : input.initial_context ?? existing.context;
        await env.DB.prepare(
          `UPDATE people SET roles = ?1, context = ?2, updated_at = ?3 WHERE id = ?4`,
        ).bind(JSON.stringify(newRoles), newContext, nowIso(), r.personId).run();
        if (input.initial_context) {
          await upsertPersonVector(env, r.personId, [newContext, existing.needs, existing.offers].filter(Boolean).join('\n\n'));
        }
      }
    }
    return { person_id: r.personId, created: r.created };
  },
};

interface UpdateInput {
  person_id: string;
  display_name?: string;
  email?: string;
  phone?: string;
  context_replacement?: string;
  context_append?: string;
  needs_replacement?: string;
  offers_replacement?: string;
  geo?: string;
  home_location?: string;
  work_location?: string;
  work_org?: string;
  roles_set?: string[];
  trajectory_tags_set?: string[];
  status_patch?: Record<string, unknown>;
  context_manual_override?: boolean;
}

export const updatePersonTool: Tool<UpdateInput, { ok: true }> = {
  name: 'update_person',
  description: 'Patch a person record. Any field omitted is left as-is. Use context_append for additive narrative updates.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string' },
      display_name: { type: 'string' },
      email: { type: 'string' },
      phone: { type: 'string', description: 'Phone number; stored E.164 normalized.' },
      home_location: { type: 'string', description: 'Where they live, e.g. "Berlin, DE".' },
      work_location: { type: 'string', description: 'Where they work, e.g. "Boulder, CO" or "Remote".' },
      work_org: { type: 'string', description: 'Organization they work at.' },
      context_replacement: { type: 'string' },
      context_append: { type: 'string' },
      needs_replacement: { type: 'string' },
      offers_replacement: { type: 'string' },
      geo: { type: 'string' },
      roles_set: { type: 'array', items: { type: 'string' } },
      trajectory_tags_set: { type: 'array', items: { type: 'string' } },
      status_patch: { type: 'object' },
      context_manual_override: { type: 'boolean' },
    },
    required: ['person_id'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const existing = await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(input.person_id).first<PersonRow>();
    if (!existing) throw new Error('person not found');

    const newDisplayName = input.display_name ?? existing.display_name;
    const newEmail = input.email ? input.email.toLowerCase() : existing.primary_email;
    const newGeo = input.geo ?? existing.geo;
    const newPhone = input.phone !== undefined ? normalizePhone(input.phone) : existing.phone;
    const newHome = input.home_location !== undefined ? (input.home_location.trim() || null) : existing.home_location;
    const newWorkLoc = input.work_location !== undefined ? (input.work_location.trim() || null) : existing.work_location;
    const newWorkOrg = input.work_org !== undefined ? (input.work_org.trim() || null) : existing.work_org;
    const newRoles = input.roles_set !== undefined ? input.roles_set : parseJsonArray(existing.roles);
    const newTraj = input.trajectory_tags_set !== undefined ? input.trajectory_tags_set : parseJsonArray(existing.trajectory_tags);
    const newStatus = input.status_patch ? { ...parseJsonObject(existing.status), ...input.status_patch } : parseJsonObject(existing.status);
    let newContext = existing.context;
    if (input.context_replacement !== undefined) newContext = input.context_replacement;
    else if (input.context_append) {
      newContext = [existing.context, `[${nowIso().slice(0, 10)}] ${input.context_append}`].filter(Boolean).join('\n\n');
    }
    const newNeeds = input.needs_replacement ?? existing.needs;
    const newOffers = input.offers_replacement ?? existing.offers;
    const newOverride = input.context_manual_override !== undefined
      ? (input.context_manual_override ? 1 : 0)
      : existing.context_manual_override;

    await env.DB.prepare(
      `UPDATE people SET
         display_name = ?1, primary_email = ?2, geo = ?3, phone = ?4,
         home_location = ?5, work_location = ?6, work_org = ?7,
         roles = ?8, trajectory_tags = ?9, status = ?10,
         context = ?11, needs = ?12, offers = ?13,
         context_manual_override = ?14, updated_at = ?15
       WHERE id = ?16`,
    ).bind(
      newDisplayName,
      newEmail,
      newGeo,
      newPhone,
      newHome,
      newWorkLoc,
      newWorkOrg,
      JSON.stringify(newRoles),
      JSON.stringify(newTraj),
      JSON.stringify(newStatus),
      newContext,
      newNeeds,
      newOffers,
      newOverride,
      nowIso(),
      input.person_id,
    ).run();

    // Re-embed if context-shaped fields changed.
    if (input.context_replacement !== undefined || input.context_append !== undefined ||
        input.needs_replacement !== undefined || input.offers_replacement !== undefined) {
      const text = [newContext, newNeeds, newOffers].filter(Boolean).join('\n\n');
      if (text.length > 0) {
        await upsertPersonVector(env, input.person_id, text);
      }
    }

    return { ok: true } as const;
  },
};

function mergeArr(existing: string[], incoming: string[] | undefined): string[] {
  if (!incoming) return existing;
  const set = new Set(existing);
  for (const x of incoming) set.add(x);
  return [...set];
}

function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const startsPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (startsPlus) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}
