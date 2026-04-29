// Weekly-section content for the Sunday email.

import type { Env } from '../../worker-configuration';
import type { ConfirmationQueueRow, FollowupRow } from '../lib/db';
import { parseJsonArray } from '../lib/db';

export interface WeeklyDigestSection {
  pending_tag_proposals: Array<{ id: string; name: string; category: string | null; example_count: number }>;
  pending_extraction_reviews: Array<{ id: string; person_id: string; summary: string }>;
  pending_classifications: number;
  pending_person_resolutions: number;
  overdue_followups: FollowupRow[];
  no_contact_in_60d_active: Array<{ id: string; display_name: string | null; last_met_date: string | null }>;
}

export async function buildWeeklyDigest(env: Env): Promise<WeeklyDigestSection> {
  const [tagProposals, queueAll, overdueFollowups, staleActive] = await Promise.all([
    env.DB.prepare(
      `SELECT id, proposed_name, proposed_category, example_person_ids
       FROM tag_proposals WHERE status = 'pending' ORDER BY created_at`,
    ).all<{ id: string; proposed_name: string; proposed_category: string | null; example_person_ids: string | null }>(),
    env.DB.prepare(
      `SELECT * FROM confirmation_queue WHERE status = 'pending' ORDER BY created_at`,
    ).all<ConfirmationQueueRow>(),
    env.DB.prepare(
      `SELECT * FROM followups WHERE status = 'open' AND due_date IS NOT NULL AND due_date < ?1`,
    ).bind(new Date().toISOString().slice(0, 10)).all<FollowupRow>(),
    env.DB.prepare(
      `SELECT id, display_name, last_met_date, trajectory_tags FROM people
       WHERE last_met_date IS NOT NULL
         AND last_met_date < date('now', '-60 days')
         AND trajectory_tags IS NOT NULL
       LIMIT 20`,
    ).all<{ id: string; display_name: string | null; last_met_date: string | null; trajectory_tags: string | null }>(),
  ]);

  const queueRows = queueAll.results ?? [];
  const pendingExtractionReviews = queueRows
    .filter((q) => q.kind === 'extraction_review')
    .slice(0, 10)
    .map((q) => {
      const payload = JSON.parse(q.payload) as { person_id: string; summary?: string };
      return { id: q.id, person_id: payload.person_id, summary: payload.summary ?? '' };
    });

  return {
    pending_tag_proposals: (tagProposals.results ?? []).map((t) => ({
      id: t.id,
      name: t.proposed_name,
      category: t.proposed_category,
      example_count: parseJsonArray(t.example_person_ids).length,
    })),
    pending_extraction_reviews: pendingExtractionReviews,
    pending_classifications: queueRows.filter((q) => q.kind === 'meeting_classification').length,
    pending_person_resolutions: queueRows.filter((q) => q.kind === 'person_resolution').length,
    overdue_followups: overdueFollowups.results ?? [],
    no_contact_in_60d_active: (staleActive.results ?? [])
      .filter((p) => parseJsonArray(p.trajectory_tags).length > 0)
      .slice(0, 10)
      .map(({ id, display_name, last_met_date }) => ({ id, display_name, last_met_date })),
  };
}

