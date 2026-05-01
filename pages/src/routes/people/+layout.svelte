<script lang="ts">
  // Shared layout for the People section: search / sort / filters / list /
  // FAB on the left; the active route's content on the right. Lifted out of
  // /people/+page.svelte so the filter pane doesn't disappear when you open
  // a profile (or the add-person chat).

  import { api } from '$lib/api';
  import type { PersonListItem } from '$lib/types';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import PeopleList from '$components/PeopleList.svelte';
  import Icon from '$components/Icon.svelte';
  import AddPersonModal from '$components/AddPersonModal.svelte';
  import { peopleRefresh } from '$lib/stores';

  let { children } = $props();

  let items = $state<PersonListItem[]>([]);
  let loading = $state(true);

  type SortKey = 'magical' | 'recent' | 'frequent' | 'custom' | 'alpha';

  // Persist sort + role filters across refreshes (TODO AL). Search text and
  // the filter-pane open/closed state are intentionally NOT persisted —
  // those feel stale on a fresh load.
  const PREFS_KEY = 'superconnector:people-list-prefs-v1';
  type Prefs = { sort: SortKey; roles: string[] };
  function loadPrefs(): Partial<Prefs> {
    if (typeof localStorage === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}'); } catch { return {}; }
  }
  const saved = loadPrefs();
  let sort = $state<SortKey>(saved.sort ?? 'magical');
  let roles = $state<string[]>(Array.isArray(saved.roles) ? saved.roles : []);
  let q = $state('');
  let filtersOpen = $state(false);

  const ROLE_OPTIONS = ['founder', 'funder', 'talent', 'advisor'];
  const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
    { key: 'magical', label: 'Default' },
    { key: 'recent', label: 'Most Recent' },
    { key: 'frequent', label: 'Most Frequent' },
    { key: 'alpha', label: 'Alphabetical' },
    { key: 'custom', label: 'Custom Order' },
  ];

  async function load() {
    loading = true;
    const url = new URLSearchParams({ sort });
    if (roles.length) url.set('roles', roles.join(','));
    if (q) url.set('q', q);
    const { items: data } = await api.get<{ items: PersonListItem[] }>(`/api/people?${url}`);
    items = data;
    loading = false;
  }
  $effect(() => { void [sort, roles, q]; load(); });

  // Refresh the list explicitly when downstream mutations bump the
  // peopleRefresh store (add person, merge, rename, delete, etc.).
  // Avoids re-fetching on every navigation, which caused a list flash
  // when picking a profile.
  $effect(() => { void $peopleRefresh; void load(); });

  // Persist prefs on change.
  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sort, roles }));
    } catch { /* quota or private mode — skip silently */ }
  });

  function toggleRole(name: string) {
    roles = roles.includes(name) ? roles.filter((r) => r !== name) : [...roles, name];
  }

  // Active id for the list highlight is read from the URL params so /people/[id]
  // shows the active row in the sidebar without prop-drilling.
  const activeId = $derived($page.params.id ?? null);

  // On mobile, hide the sidebar when a sub-route is active so the right
  // pane has the full screen. Toggling back to /people shows the list.
  const onSubroute = $derived($page.url.pathname !== '/people');

  let addOpen = $state(false);
  let searchEl: HTMLInputElement | undefined = $state();

  // Global keyboard shortcuts for the People section. Single-modifier
  // (Cmd on macOS, Ctrl elsewhere) so they fire even from inputs.
  // Each shortcut is a TOGGLE — pressing it again undoes the action:
  //   ⌘E → open Add Person modal (or close it if already open)
  //   ⌘P → focus search (or blur it if it's already focused)
  //   ⌘J → focus per-person chat (or blur it if it's already focused)
  function onKey(e: KeyboardEvent) {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.shiftKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'e') {
      e.preventDefault();
      addOpen = !addOpen;
    } else if (k === 'p') {
      e.preventDefault();
      if (searchEl && document.activeElement === searchEl) {
        searchEl.blur();
      } else {
        searchEl?.focus();
        searchEl?.select();
      }
    } else if (k === 'j') {
      e.preventDefault();
      // PersonProfile owns the textarea ref. Send a "toggle" event; if the
      // chat textarea is currently focused, it'll blur, else it'll focus.
      window.dispatchEvent(new CustomEvent('superconnector:focus-person-chat'));
    }
  }
  $effect(() => {
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // OS-aware kbd glyphs for the on-screen hints.
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  const kbdMod = isMac ? '⌘' : 'Ctrl+';
  const kbdAdd = `${kbdMod}E`;
  const kbdFind = `${kbdMod}P`;

  let meId = $state<string | null>(null);
  $effect(() => { void loadMe(); });
  async function loadMe() {
    try {
      const r = await api.get<{ person_id: string }>('/api/people/me');
      meId = r.person_id;
    } catch {
      meId = null;
    }
  }

  // When the user lands on /people exactly (no subroute), auto-redirect
  // them to the top person in the current list. Skips the hollow
  // "Pick a person" placeholder. `replaceState: true` so back/forward
  // doesn't get stuck looping into the same redirect.
  $effect(() => {
    if (
      !loading &&
      items.length > 0 &&
      $page.url.pathname === '/people' &&
      typeof window !== 'undefined'
    ) {
      const topId = items[0]?.person_id;
      if (topId) goto(`/people/${topId}`, { replaceState: true });
    }
  });

  // While the user is typing in search and the active person is no longer
  // in the filtered set, auto-jump to the top result so the right pane
  // tracks what they're searching for. Don't navigate when results are
  // empty (leave them on whatever they were viewing). Also skip when
  // there's no current subroute (the redirect above handles that case).
  $effect(() => {
    if (loading || items.length === 0) return;
    if (!q || !q.trim()) return;
    if ($page.url.pathname === '/people') return;
    const inSet = activeId && items.some((p) => p.person_id === activeId);
    if (!inSet) {
      const topId = items[0]?.person_id;
      if (topId && topId !== activeId) {
        goto(`/people/${topId}`, { replaceState: true, keepFocus: true, noScroll: true });
      }
    }
  });
</script>

<div class="layout" data-pane={onSubroute ? 'detail' : 'list'}>
  <aside class="sidebar">
    <div class="sidebar-top">
    <div class="search-wrap">
      <span class="search-icon" aria-hidden="true"><Icon name="search" size={16} /></span>
      <input
        class="search-input"
        type="search"
        placeholder="Search name, email, context…"
        bind:value={q}
        bind:this={searchEl}
      />
      <span class="search-kbd" aria-hidden="true">{kbdFind}</span>
    </div>

    <div class="sort-row">
      <details class="sort-menu">
        <summary>
          <Icon name="sort" size={14} />
          <span>{SORT_OPTIONS.find((o) => o.key === sort)?.label ?? 'Sort'}</span>
          <Icon name="chevron-down" size={14} />
        </summary>
        <ul class="sort-list" role="listbox">
          {#each SORT_OPTIONS as opt}
            <li>
              <button
                role="option"
                aria-selected={sort === opt.key}
                class:active={sort === opt.key}
                onclick={(e) => {
                  sort = opt.key;
                  const d = (e.currentTarget as HTMLElement).closest('details');
                  if (d) d.removeAttribute('open');
                }}
              >{opt.label}</button>
            </li>
          {/each}
        </ul>
      </details>
      <span class="spacer"></span>
      <button class="filters-toggle" onclick={() => (filtersOpen = !filtersOpen)} aria-expanded={filtersOpen}>
        <Icon name="filter" size={14} />
        Filters{roles.length > 0 ? ` · ${roles.length}` : ''}
        <Icon name="chevron-down" size={12} />
      </button>
    </div>

    {#if filtersOpen}
      <div class="filters">
        <div class="label">Roles</div>
        <div class="chips">
          {#each ROLE_OPTIONS as r}
            <button class="chip" class:active={roles.includes(r)} onclick={() => toggleRole(r)}>{r}</button>
          {/each}
        </div>
      </div>
    {/if}

    </div><!-- /.sidebar-top -->

    <div class="sidebar-list">
      <PeopleList
        {items}
        {loading}
        {activeId}
        reorderable={sort === 'custom'}
        onSelect={(id) => goto(`/people/${id}`)}
        onReorder={async (movedId, before, after) => {
          await api.post(`/api/people/${movedId}/reorder`, { before, after });
          await load();
        }}
      />
    </div>

    <div class="sidebar-foot">
      {#if meId}
        <a
          href={`/people/${meId}`}
          class="me-btn"
          class:active={activeId === meId}
          aria-label="Open my profile"
          title="My profile"
        >
          <Icon name="users" size={16} />
        </a>
      {/if}
      <button
        class="add-person-btn"
        onclick={() => (addOpen = true)}
        aria-label="Add a new person ({kbdAdd})"
        title="Add a new person ({kbdAdd})"
      >
        <Icon name="plus" size={14} />
        Add Person
        <span class="kbd-inline">{kbdAdd}</span>
      </button>
    </div>
  </aside>

  <section class="content">
    {@render children()}
  </section>
</div>

{#if addOpen}
  <AddPersonModal onClose={() => (addOpen = false)} />
{/if}

<svelte:head>
  <title>People · superconnector</title>
</svelte:head>

<style>
  .layout {
    display: grid;
    grid-template-columns: var(--pane-w) 1fr;
    width: 100%;
    height: 100%;
    min-height: 0;
  }
  .sidebar {
    border-right: 1px solid var(--border);
    background: white;
    /* Three-row grid: header (auto) / scrollable list (1fr) / footer (auto).
       Lets the Add Person button sit on the actual bottom edge of the pane,
       not at the end of a flex column whose height is just its content. */
    display: grid;
    grid-template-rows: auto 1fr auto;
    min-height: 0;
  }
  .sidebar-top {
    padding: 12px 12px 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sidebar-list {
    overflow-y: auto;
    padding: 0 12px 8px;
    min-height: 0;
  }
  .sidebar-foot {
    padding: 8px 12px 12px;
    border-top: 1px solid var(--border);
    background: white;
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .me-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    flex-shrink: 0;
    border: 1px solid var(--border);
    border-radius: 10px;
    color: var(--muted);
    background: white;
    text-decoration: none;
  }
  .me-btn:hover { background: var(--hover); color: var(--fg); text-decoration: none; }
  .me-btn.active { color: var(--accent); border-color: var(--accent); background: rgba(67, 56, 202, 0.06); }
  .content { overflow-y: auto; min-height: 0; }

  .filters { display: flex; flex-direction: column; gap: 6px; }
  .label { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip.more { background: white; border-style: dashed; }

  .search-wrap { position: relative; display: flex; }
  .search-icon {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--muted);
    pointer-events: none;
    display: inline-flex;
  }
  .search-input {
    padding-left: 32px;
    padding-right: 56px; /* room for the kbd badge */
    flex: 1;
    font-size: 13px;
    line-height: 1.3;
  }
  .search-input::placeholder { font-size: 13px; }
  .search-kbd {
    position: absolute;
    right: 8px;
    top: 50%;
    transform: translateY(-50%);
    pointer-events: none;
    color: var(--muted);
    font-size: 12px;
    line-height: 16px;
    padding: 1px 6px;
    background: rgba(0, 0, 0, 0.04);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .search-input:focus + .search-kbd { opacity: 0; }
  .search-input { padding-right: 64px; }

  .sort-row { display: flex; gap: 8px; align-items: center; }
  .sort-menu { position: relative; }
  .sort-menu > summary {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: white;
    cursor: pointer;
    list-style: none;
  }
  .sort-menu > summary::-webkit-details-marker { display: none; }
  .sort-menu > summary::marker { display: none; }
  .sort-list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    list-style: none;
    padding: 4px;
    margin: 0;
    background: white;
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.06);
    z-index: 10;
    min-width: 180px;
  }
  .sort-list li { margin: 0; }
  .sort-list button {
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    padding: 8px 10px;
    border-radius: 6px;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }
  .sort-list button:hover { background: var(--hover); }
  .sort-list button.active { background: var(--hover); color: var(--accent); }

  .filters-toggle {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 10px;
    color: var(--muted);
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .filters-toggle:hover { background: var(--hover); color: var(--fg); }

  .add-person-btn {
    width: 100%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 10px 16px;
    border-radius: 10px;
    background: white;
    color: var(--fg);
    border: 1px solid var(--border);
    font: inherit;
    font-weight: 500;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .add-person-btn:hover { background: var(--hover); border-color: var(--muted); }
  .kbd-inline {
    display: inline-block;
    padding: 1px 6px;
    margin-left: 6px;
    background: rgba(0, 0, 0, 0.06);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    line-height: 16px;
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    .layout[data-pane='detail'] .sidebar { display: none; }
    .layout[data-pane='list'] .content { display: none; }
    .sidebar { border-right: 0; }
    .sidebar-foot { padding-bottom: calc(12px + var(--safe-bottom)); }
  }
</style>
