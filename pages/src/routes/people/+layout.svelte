<script lang="ts">
  // Shared layout for the People section: search / sort / filters / list /
  // FAB on the left; the active route's content on the right. Lifted out of
  // /people/+page.svelte so the filter pane doesn't disappear when you open
  // a profile (or the add-person chat).

  import { api } from '$lib/api';
  import type { PersonListItem, TagRow } from '$lib/types';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import PeopleList from '$components/PeopleList.svelte';
  import Icon from '$components/Icon.svelte';
  import SegmentedToggle from '$components/SegmentedToggle.svelte';
  import AddPersonModal from '$components/AddPersonModal.svelte';

  let { children } = $props();

  let items = $state<PersonListItem[]>([]);
  let allTags = $state<TagRow[]>([]);
  let loading = $state(true);

  type SortKey = 'magical' | 'recent' | 'frequent' | 'custom' | 'alpha';
  let sort = $state<SortKey>('magical');
  let tags = $state<string[]>([]);
  let roles = $state<string[]>([]);
  let tagMode = $state<'or' | 'and'>('or');
  let q = $state('');
  let filtersOpen = $state(false);
  let tagsExpanded = $state(false);

  const ROLE_OPTIONS = ['founder', 'funder', 'talent', 'advisor'];
  const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
    { key: 'magical', label: 'Magical' },
    { key: 'recent', label: 'Most recent' },
    { key: 'frequent', label: 'Most frequent' },
    { key: 'alpha', label: 'Alphabetical' },
    { key: 'custom', label: 'Custom order' },
  ];

  async function load() {
    loading = true;
    const url = new URLSearchParams({ sort, tag_mode: tagMode });
    if (tags.length) url.set('tags', tags.join(','));
    if (roles.length) url.set('roles', roles.join(','));
    if (q) url.set('q', q);
    const { items: data } = await api.get<{ items: PersonListItem[] }>(`/api/people?${url}`);
    items = data;
    loading = false;
  }
  async function loadTags() {
    const { tags: t } = await api.get<{ tags: TagRow[] }>(`/api/tags`);
    allTags = t;
  }
  $effect(() => { void [sort, tags, roles, tagMode, q]; load(); });
  $effect(() => { loadTags(); });

  function toggleTag(name: string) {
    tags = tags.includes(name) ? tags.filter((t) => t !== name) : [...tags, name];
  }
  function toggleRole(name: string) {
    roles = roles.includes(name) ? roles.filter((r) => r !== name) : [...roles, name];
  }

  const TAG_COLLAPSED_LIMIT = 12;

  // Active id for the list highlight is read from the URL params so /people/[id]
  // shows the active row in the sidebar without prop-drilling.
  const activeId = $derived($page.params.id ?? null);

  // On mobile, hide the sidebar when a sub-route is active so the right
  // pane has the full screen. Toggling back to /people shows the list.
  const onSubroute = $derived($page.url.pathname !== '/people');

  let addOpen = $state(false);
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
      />
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
        Filters{(roles.length + tags.length) > 0 ? ` · ${roles.length + tags.length}` : ''}
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
        <div class="label row">
          <span>Tags</span>
          <span class="spacer"></span>
          <SegmentedToggle
            ariaLabel="Tag combine mode"
            options={[
              { value: 'or', label: 'Match any' },
              { value: 'and', label: 'Match all' },
            ]}
            bind:selected={tagMode}
          />
        </div>
        <div class="chips chips-tags">
          {#if allTags.length === 0}
            <span class="muted small">no tags yet</span>
          {/if}
          {#each (tagsExpanded ? allTags : allTags.slice(0, TAG_COLLAPSED_LIMIT)) as t}
            <button class="chip" class:active={tags.includes(t.name)} onclick={() => toggleTag(t.name)}>
              {t.name}<span class="muted small">·{t.use_count}</span>
            </button>
          {/each}
          {#if allTags.length > TAG_COLLAPSED_LIMIT}
            <button class="chip more" onclick={() => (tagsExpanded = !tagsExpanded)}>
              {tagsExpanded ? 'less' : `+${allTags.length - TAG_COLLAPSED_LIMIT} more`}
            </button>
          {/if}
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
      <button
        class="add-person-btn"
        onclick={() => (addOpen = true)}
        aria-label="Add a new person"
      >
        <Icon name="plus" size={14} />
        Add Person
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
  }
  .content { overflow-y: auto; min-height: 0; }

  .filters { display: flex; flex-direction: column; gap: 6px; }
  .label { font-size: 12px; color: var(--muted); margin-top: 8px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chips-tags { max-height: 30vh; overflow-y: auto; }
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
  .search-input { padding-left: 32px; flex: 1; }

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

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    .layout[data-pane='detail'] .sidebar { display: none; }
    .layout[data-pane='list'] .content { display: none; }
    .sidebar { border-right: 0; }
    .sidebar-foot { padding-bottom: calc(12px + var(--safe-bottom)); }
  }
</style>
