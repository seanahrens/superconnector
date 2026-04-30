<script lang="ts">
  import { api } from '$lib/api';
  import type { PersonListItem, TagRow } from '$lib/types';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import PeopleList from '$components/PeopleList.svelte';
  import Icon from '$components/Icon.svelte';

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
  const SORT_OPTIONS: Array<{
    key: SortKey;
    label: string;
    icon: 'sparkles' | 'clock' | 'bar-chart-2' | 'grip-vertical' | 'arrow-down-az';
  }> = [
    { key: 'magical', label: 'Magical', icon: 'sparkles' },
    { key: 'recent', label: 'Most recent', icon: 'clock' },
    { key: 'frequent', label: 'Most frequent', icon: 'bar-chart-2' },
    { key: 'alpha', label: 'Alphabetical', icon: 'arrow-down-az' },
    { key: 'custom', label: 'Custom order', icon: 'grip-vertical' },
  ];

  async function load() {
    loading = true;
    const url = new URLSearchParams({
      sort,
      tag_mode: tagMode,
    });
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
  const ROLE_COLLAPSED_LIMIT = 6;
</script>

<div class="layout">
  <aside class="sidebar">
    <div class="search-row">
      <div class="search-wrap">
        <span class="search-icon" aria-hidden="true"><Icon name="search" size={16} /></span>
        <input
          class="search-input"
          type="search"
          placeholder="Search name, email, context…"
          bind:value={q}
        />
      </div>
      <a href="/people/new" class="btn add-person" aria-label="Add a new person" title="Add a new person">
        <Icon name="plus" size={16} />
        <span class="add-label">add</span>
      </a>
    </div>

    <!-- Sort: a small button that opens a popup of options with icons. The
         label text is just the option name (no "(recency × frequency)"
         parenthetical) — feature names should sell themselves. -->
    <div class="sort-row">
      <details class="sort-menu">
        {#snippet currentLabel()}
          {#each SORT_OPTIONS.filter((o) => o.key === sort) as cur}
            <Icon name={cur.icon} size={14} />
            <span>{cur.label}</span>
          {/each}
        {/snippet}
        <summary>
          {@render currentLabel()}
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
                  // close the <details> popup
                  const d = (e.currentTarget as HTMLElement).closest('details');
                  if (d) d.removeAttribute('open');
                }}
              >
                <Icon name={opt.icon} size={14} /> {opt.label}
              </button>
            </li>
          {/each}
        </ul>
      </details>
      <span class="spacer"></span>
      <button class="filters-toggle" onclick={() => (filtersOpen = !filtersOpen)} aria-expanded={filtersOpen}>
        Filters{(roles.length + tags.length) > 0 ? ` · ${roles.length + tags.length}` : ''}
        <Icon name="chevron-down" size={12} />
      </button>
    </div>

    {#if filtersOpen}
      <div class="filters">
        <div class="label">Roles</div>
        <div class="chips">
          {#each ROLE_OPTIONS.slice(0, ROLE_COLLAPSED_LIMIT) as r}
            <button
              class="chip"
              class:active={roles.includes(r)}
              onclick={() => toggleRole(r)}
            >{r}</button>
          {/each}
        </div>

        <div class="label row">
          <span>Tags</span>
          <span class="spacer"></span>
          <select bind:value={tagMode} aria-label="Tag combine mode">
            <option value="or">any</option>
            <option value="and">all</option>
          </select>
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

    <hr />
    <PeopleList
      {items}
      {loading}
      activeId={$page.params.id ?? null}
      reorderable={sort === 'custom'}
      onSelect={(id) => goto(`/people/${id}`)}
      onReorder={async (movedId, before, after) => {
        await api.post(`/api/people/${movedId}/reorder`, { before, after });
        await load();
      }}
    />
  </aside>

  <section class="content">
    <div class="empty">
      <p class="muted">Pick a person.</p>
    </div>
  </section>
</div>

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
    overflow-y: auto;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .filters {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .label {
    font-size: 12px;
    color: var(--muted);
    margin-top: 8px;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .chips-tags { max-height: 30vh; overflow-y: auto; }
  .chip.more {
    background: white;
    border-style: dashed;
  }

  .search-row { display: flex; gap: 6px; align-items: stretch; }
  .search-wrap { position: relative; display: flex; flex: 1; }
  .add-person { flex-shrink: 0; }
  @media (max-width: 720px) {
    .add-label { display: none; }
  }
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
  .content {
    overflow-y: auto;
    padding: 24px;
  }
  .empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { border-right: 0; padding: 12px; }
    /* On mobile, the people list IS the page — hide the empty
       "pick a person" panel; tapping a row navigates to /people/[id]. */
    .content { display: none; }
  }
</style>
