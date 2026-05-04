// Shapes the Worker API returns to the SvelteKit Pages app. These are the
// canonical definitions; pages/src/lib/types.ts mirrors them as a string
// because the Worker and Pages bundles can't share a module at build time.
//
// If you add a field here, add it in pages/src/lib/types.ts as well — and
// vice versa. svelte-check + tsc will not catch the drift; only runtime will.

/** One row in the people-list response (`GET /api/people`). */
export interface PersonListItem {
  person_id: string;
  display_name: string | null;
  email: string | null;
  roles: string[];
  trajectory_tags: string[];
  tags: string[];
  last_met_date: string | null;
  meeting_count: number;
  custom_sort_position: string | null;
  /** Connection degree from You: 0 = You, 1 = direct, 2 = needs intro. */
  degree: number;
}
