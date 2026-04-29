<script lang="ts">
  import { api } from '$lib/api';
  import type { PersonView, PersonListItem, TagRow } from '$lib/types';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import PeopleList from '$components/PeopleList.svelte';
  import PersonProfile from '$components/PersonProfile.svelte';

  let view = $state<PersonView | null>(null);
  let items = $state<PersonListItem[]>([]);
  let allTags = $state<TagRow[]>([]);
  let loadingList = $state(true);

  $effect(() => {
    const id = $page.params.id;
    if (id) loadProfile(id);
  });

  $effect(() => { loadList(); loadTags(); });

  async function loadProfile(id: string) {
    view = null;
    view = await api.get<PersonView>(`/api/people/${id}`);
  }
  async function loadList() {
    loadingList = true;
    const { items: data } = await api.get<{ items: PersonListItem[] }>(`/api/people?sort=magical&limit=200`);
    items = data;
    loadingList = false;
  }
  async function loadTags() {
    const { tags } = await api.get<{ tags: TagRow[] }>(`/api/tags`);
    allTags = tags;
  }

  async function refreshAll() {
    const id = $page.params.id;
    await Promise.all([id ? loadProfile(id) : Promise.resolve(), loadList(), loadTags()]);
  }
</script>

<div class="layout">
  <aside class="sidebar">
    <div class="muted small" style="padding: 4px 6px">{items.length} people</div>
    <PeopleList
      {items}
      loading={loadingList}
      activeId={$page.params.id ?? null}
      reorderable={false}
      onSelect={(id) => goto(`/people/${id}`)}
    />
  </aside>
  <section class="content">
    {#if view}
      <PersonProfile {view} {allTags} onChanged={refreshAll} />
    {:else}
      <div class="muted">Loading…</div>
    {/if}
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
  }
  .content {
    overflow-y: auto;
    padding: 24px;
    display: flex;
    flex-direction: column;
  }
</style>
