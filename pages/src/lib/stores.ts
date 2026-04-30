// Tiny shared signal stores. Components mutate the counter; subscribers
// (e.g. the people layout) re-fetch their data when it bumps. Cheaper than
// a full SvelteKit invalidate / route reload, and avoids the navigation-
// based refresh flash.

import { writable } from 'svelte/store';

/** Incremented when the people list needs a refetch (after an add /
    rename / delete / etc.). */
export const peopleRefresh = writable(0);
export function bumpPeople() {
  peopleRefresh.update((n) => n + 1);
}
