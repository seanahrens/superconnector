// Apply ExtractionResult to the database, gated by confidence and split between
// direct writes (high-confidence facts) and confirmation_queue items (low-confidence).
//
// Re-embedding hash is computed against the *new* person context after writes.

import type { Env } from '../../worker-configuration';
import type { ExtractionResult, ExtractedPersonUpdates, ExtractedSignal } from './extract';
import type { PersonRow } from './db';
import { parseJsonArray, parseJsonObject } from './db';
import { upsertPersonVector } from './embed';
import { normalizeTagName, normalizeTagArray } from './tag_norm';
import { ulid, nowIso } from './ulid';

const HIGH_CONFIDENCE = 0.7;

export interface ApplyOptions {
  personId: string;
  /** Meeting this extraction belongs to. When null/undefined, the extraction
      is treated as a free-floating annotation: no meeting_count bump, no
      last_met_date change, and signals are inserted with meeting_id NULL.
      Used by the dictate tool so freeform "annotation" doesn't manufacture
      a phantom past meeting. */
  meetingId: string | null;
  result: ExtractionResult;
  /** ISO timestamp of when the meeting actually happened (the Granola note's
      `created_at`, or the manual-dictation time). Used to set `last_met_date`
      to the *meeting* date, not the time the ingest cron happened to run.
      Older meetings ingested later don't back-date the field — we use MAX. */
  meetingRecordedAt?: string | null;
  // True when re-applying extraction for a Granola note whose content
  // changed since it was first ingested. We then skip bumping meeting_count
  // and last_met_date (the meeting is the same), and we wipe prior signals
  // for this meeting so they don't pile up alongside the new ones. Followups
  // are intentionally kept (the user may have interacted with them).
  reprocess?: boolean;
  /** When set, also apply result.user_updates / result.user_signals to
      this id (the "Me" person). Lets self-statements made by the
      microphone speaker accumulate on the user's own row. */
  mePersonId?: string | null;
}

export async function applyExtractionResult(env: Env, opts: ApplyOptions): Promise<void> {
  const { personId, meetingId, result, reprocess, meetingRecordedAt } = opts;
  const now = nowIso();
  // Date the meeting was actually held. Falls back to today only if the
  // caller didn't supply one (manual dictation with no timestamp).
  const metDate = (meetingRecordedAt ?? now).slice(0, 10);

  const person = await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(personId).first<PersonRow>();
  if (!person) throw new Error(`person not found: ${personId}`);

  const updates = result.person_updates;
  const lowConfidence = result.extraction_confidence < HIGH_CONFIDENCE;

  if (reprocess && meetingId) {
    await env.DB.prepare(
      `DELETE FROM signals WHERE meeting_id = ?1`,
    ).bind(meetingId).run();
    await env.DB.prepare(
      `UPDATE people SET updated_at = ?1 WHERE id = ?2`,
    ).bind(now, personId).run();
  } else if (meetingId) {
    // First ingest of this meeting — count it. last_met_date keeps the
    // greater of the existing value and this meeting's date so old notes
    // ingested after newer ones don't regress the indicator.
    await env.DB.prepare(
      `UPDATE people
       SET last_met_date = CASE
             WHEN last_met_date IS NULL OR ?1 > last_met_date THEN ?1
             ELSE last_met_date
           END,
           meeting_count = meeting_count + 1,
           updated_at = ?2
       WHERE id = ?3`,
    ).bind(metDate, now, personId).run();
  } else {
    // No meeting attached (manual dictation / annotation). Just bump updated_at.
    await env.DB.prepare(
      `UPDATE people SET updated_at = ?1 WHERE id = ?2`,
    ).bind(now, personId).run();
  }

  // Direct writes for high-confidence cases.
  if (!lowConfidence) {
    const newDisplayName = updates.display_name ?? person.display_name ?? null;
    const newRoles = mergeArray(parseJsonArray(person.roles), normalizeTagArray(updates.roles_add));
    const newTraj = mergeArray(parseJsonArray(person.trajectory_tags), normalizeTagArray(updates.trajectory_tags_add));
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
    const newHome = updates.home_location ?? person.home_location ?? null;
    const newWorkLoc = updates.work_location ?? person.work_location ?? null;
    const newWorkOrg = updates.work_org ?? person.work_org ?? null;

    await env.DB.prepare(
      `UPDATE people
       SET display_name = ?1,
           roles = ?2,
           trajectory_tags = ?3,
           status = ?4,
           context = ?5,
           needs = ?6,
           offers = ?7,
           home_location = ?8,
           work_location = ?9,
           work_org = ?10,
           updated_at = ?11
       WHERE id = ?12`,
    ).bind(
      newDisplayName,
      JSON.stringify(newRoles),
      JSON.stringify(newTraj),
      JSON.stringify(newStatus),
      newContext,
      newNeeds,
      newOffers,
      newHome,
      newWorkLoc,
      newWorkOrg,
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
      normalizeTagName(prop.name),
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

  // "Me" updates from microphone-side self-statements. Only apply when:
  //   - we have a mePersonId,
  //   - the LLM extracted user_updates and/or user_signals,
  //   - the kept counterpart isn't already the user (don't double-write
  //     to a 1:1 with yourself, which shouldn't happen anyway).
  if (
    opts.mePersonId &&
    opts.mePersonId !== personId &&
    (result.user_updates || (result.user_signals && result.user_signals.length > 0))
  ) {
    await applySelfUpdates(env, opts.mePersonId, meetingId, result.user_updates, result.user_signals, lowConfidence, now);
  }
}

async function applySelfUpdates(
  env: Env,
  meId: string,
  meetingId: string | null,
  updates: ExtractedPersonUpdates | undefined,
  signals: ExtractedSignal[] | undefined,
  lowConfidence: boolean,
  now: string,
): Promise<void> {
  const me = await env.DB.prepare('SELECT * FROM people WHERE id = ?1').bind(meId).first<PersonRow>();
  if (!me) return;

  if (updates && !lowConfidence) {
    const newDisplayName = updates.display_name ?? me.display_name ?? null;
    const newRoles = mergeArray(parseJsonArray(me.roles), normalizeTagArray(updates.roles_add));
    const newTraj = mergeArray(parseJsonArray(me.trajectory_tags), normalizeTagArray(updates.trajectory_tags_add));
    const newStatus = { ...parseJsonObject(me.status), ...(updates.status_patch ?? {}) };
    let newContext = me.context;
    if (updates.context_delta) {
      const dateMarker = `[${now.slice(0, 10)}]`;
      newContext = me.context_manual_override
        ? me.context
        : [me.context, `${dateMarker} ${updates.context_delta}`].filter(Boolean).join('\n\n');
    }
    const newNeeds = updates.needs_replacement ?? me.needs;
    const newOffers = updates.offers_replacement ?? me.offers;
    const newHome = updates.home_location ?? me.home_location ?? null;
    const newWorkLoc = updates.work_location ?? me.work_location ?? null;
    const newWorkOrg = updates.work_org ?? me.work_org ?? null;

    await env.DB.prepare(
      `UPDATE people
         SET display_name = ?1, roles = ?2, trajectory_tags = ?3, status = ?4,
             context = ?5, needs = ?6, offers = ?7,
             home_location = ?8, work_location = ?9, work_org = ?10,
             updated_at = ?11
       WHERE id = ?12`,
    ).bind(
      newDisplayName,
      JSON.stringify(newRoles),
      JSON.stringify(newTraj),
      JSON.stringify(newStatus),
      newContext,
      newNeeds,
      newOffers,
      newHome,
      newWorkLoc,
      newWorkOrg,
      now,
      meId,
    ).run();

    if (updates.context_delta || updates.needs_replacement || updates.offers_replacement) {
      const text = [newContext, newNeeds, newOffers].filter(Boolean).join('\n\n');
      if (text.length > 0) {
        try {
          await upsertPersonVector(env, meId, text);
        } catch (err) {
          console.error('apply self updates: re-embed failed', err);
        }
      }
    }
  }

  if (signals && signals.length > 0) {
    for (const sig of signals) {
      await env.DB.prepare(
        `INSERT INTO signals (id, person_id, meeting_id, kind, body, confidence, superseded_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7)`,
      ).bind(ulid(), meId, meetingId, sig.kind, sig.body, sig.confidence, now).run();
    }
  }
}

function mergeArray(existing: string[], incoming: string[] | undefined): string[] {
  if (!incoming || incoming.length === 0) return existing;
  const set = new Set(existing);
  for (const x of incoming) set.add(x);
  return [...set];
}

