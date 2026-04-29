// Apply ExtractionResult to the database, gated by confidence and split between
// direct writes (high-confidence facts) and confirmation_queue items (low-confidence).
//
// Re-embedding hash is computed against the *new* person context after writes.

import type { Env } from '../../worker-configuration';
import type { ExtractionResult } from './extract';
import type { PersonRow } from './db';
import { parseJsonArray, parseJsonObject } from './db';
import { upsertPersonVector } from './embed';
import { ulid, nowIso } from './ulid';

const HIGH_CONFIDENCE = 0.7;

export interface ApplyOptions {
  personId: string;
  meetingId: string;
  result: ExtractionResult;
}

export async function applyExtractionResult(env: Env, opts: ApplyOptions): Promise<void> {
  const { personId, meetingId, result } = opts;
  const now = nowIso();

  const person = await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(personId).first<PersonRow>();
  if (!person) throw new Error(`person not found: ${personId}`);

  const updates = result.person_updates;
  const lowConfidence = result.extraction_confidence < HIGH_CONFIDENCE;

  // Always update last_met_date and bump meeting_count, even when confidence is low.
  await env.DB.prepare(
    `UPDATE people
     SET last_met_date = ?1,
         meeting_count = meeting_count + 1,
         updated_at = ?2
     WHERE id = ?3`,
  ).bind(now.slice(0, 10), now, personId).run();

  // Direct writes for high-confidence cases.
  if (!lowConfidence) {
    const newDisplayName = updates.display_name ?? person.display_name ?? null;
    const newRoles = mergeArray(parseJsonArray(person.roles), updates.roles_add);
    const newTraj = mergeArray(parseJsonArray(person.trajectory_tags), updates.trajectory_tags_add);
    const newStatus = { ...parseJsonObject(person.status), ...(updates.status_patch ?? {}) };

    let newContext = person.context;
    if (updates.context_delta) {
      const dateMarker = `[${now.slice(0, 10)}]`;
      newContext = person.context_manual_override
        ? person.context // never overwrite manual override
        : [person.context, `${dateMarker} ${updates.context_delta}`].filter(Boolean).join('\n\n');
    }

    const newNeeds = updates.needs_replacement ?? person.needs;
    const newOffers = updates.offers_replacement ?? person.offers;

    await env.DB.prepare(
      `UPDATE people
       SET display_name = ?1,
           roles = ?2,
           trajectory_tags = ?3,
           status = ?4,
           context = ?5,
           needs = ?6,
           offers = ?7,
           updated_at = ?8
       WHERE id = ?9`,
    ).bind(
      newDisplayName,
      JSON.stringify(newRoles),
      JSON.stringify(newTraj),
      JSON.stringify(newStatus),
      newContext,
      newNeeds,
      newOffers,
      now,
      personId,
    ).run();
  } else {
    // Park the diff for the user to review.
    await env.DB.prepare(
      `INSERT INTO confirmation_queue (id, kind, payload, status, created_at)
       VALUES (?1, 'extraction_review', ?2, 'pending', ?3)`,
    ).bind(
      ulid(),
      JSON.stringify({ person_id: personId, meeting_id: meetingId, updates, summary: result.summary }),
      now,
    ).run();
  }

  // Signals: write all, but flag low confidence on individual signals via the confidence field.
  for (const sig of result.signals) {
    await env.DB.prepare(
      `INSERT INTO signals (id, person_id, meeting_id, kind, body, confidence, superseded_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)`,
    ).bind(ulid(), personId, meetingId, sig.kind, sig.body, sig.confidence, now).run();
  }

  // Tag proposals → tag_proposals queue (they all need user review by design).
  for (const prop of result.tag_proposals) {
    await env.DB.prepare(
      `INSERT INTO tag_proposals (id, proposed_name, proposed_category, example_person_ids, status, created_at)
       VALUES (?1, ?2, ?3, ?4, 'pending', ?5)`,
    ).bind(
      ulid(),
      prop.name,
      prop.category,
      JSON.stringify([personId]),
      now,
    ).run();
  }

  // Followups → direct write (they're commitments the user made).
  for (const fu of result.followups) {
    await env.DB.prepare(
      `INSERT INTO followups (id, person_id, meeting_id, body, due_date, status, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6)`,
    ).bind(ulid(), personId, meetingId, fu.body, fu.due_date ?? null, now).run();
  }

  // Re-embed if context-shaped fields likely changed.
  if (!lowConfidence && (updates.context_delta || updates.needs_replacement || updates.offers_replacement)) {
    const fresh = await env.DB.prepare(
      'SELECT context, needs, offers FROM people WHERE id = ?1',
    ).bind(personId).first<{ context: string | null; needs: string | null; offers: string | null }>();
    const text = [fresh?.context, fresh?.needs, fresh?.offers].filter(Boolean).join('\n\n');
    if (text.length > 0) {
      await upsertPersonVector(env, personId, text);
    }
  }
}

function mergeArray(existing: string[], incoming: string[] | undefined): string[] {
  if (!incoming || incoming.length === 0) return existing;
  const set = new Set(existing);
  for (const x of incoming) set.add(x);
  return [...set];
}
