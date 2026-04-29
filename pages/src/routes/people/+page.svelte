<script lang="ts">
  import { api } from '$lib/api';
  import type { PersonListItem, TagRow } from '$lib/types';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import PeopleList from '$components/PeopleList.svelte';

  let items = $state<PersonListItem[]>([]);
  let allTags = $state<TagRow[]>([]);
  let loading = $state(true);

  let sort = $state<'magical' | 'recent' | 'frequent' | 'custom'>('magical');
  let tags = $state<string[]>([]);
  let roles = $state<string[]>([]);
  let tagMode = $state<'or' | 'and'>('or');
  let q = $state('');

  const ROLE_OPTIONS = ['founder', 'funder', 'talent', 'advisor'];

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
</script>

<div class="layout">
  <aside class="sidebar">
    <input type="search" placeholder="Search name, email, context…" bind:value={q} />
    <div class="filters">
      <div class="label">Roles</div>
      <div class="chips">
        {#each ROLE_OPTIONS as r}
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
        <select bind:value={tagMode}>
          <option value="or">any</option>
          <option value="and">all</option>
        </select>
      </div>
      <div class="chips">
        {#if allTags.length === 0}
          <span class="muted small">no tags yet</span>
        {/if}
        {#each allTags.slice(0, 30) as t}
          <button class="chip" class:active={tags.includes(t.name)} onclick={() => toggleTag(t.name)}>
            {t.name}<span class="muted small">·{t.use_count}</span>
          </button>
        {/each}
      </div>

      <div class="label">Sort</div>
      <select bind:value={sort}>
        <option value="magical">magical (recency × frequency × custom)</option>
        <option value="recent">most recent meeting</option>
        <option value="frequent">most frequent</option>
        <option value="custom">my custom order</option>
      </select>
    </div>

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
</style>
