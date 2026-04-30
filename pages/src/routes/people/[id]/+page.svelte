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
  let loadError = $state<string | null>(null);

  $effect(() => {
    const id = $page.params.id;
    if (id) loadProfile(id);
  });

  $effect(() => { loadList(); loadTags(); });

  async function loadProfile(id: string) {
    view = null;
    loadError = null;
    try {
      view = await api.get<PersonView>(`/api/people/${id}`);
    } catch (err) {
      loadError = (err as Error).message;
    }
  }
  async function loadList() {
    loadingList = true;
    try {
      const { items: data } = await api.get<{ items: PersonListItem[] }>(`/api/people?sort=magical&limit=200`);
      items = data;
    } catch (err) {
      loadError = loadError ?? (err as Error).message;
    } finally {
      loadingList = false;
    }
  }
  async function loadTags() {
    try {
      const { tags } = await api.get<{ tags: TagRow[] }>(`/api/tags`);
      allTags = tags;
    } catch {
      /* tags are optional */
    }
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
    <a href="/people" class="mobile-back btn small">← all people</a>
    {#if loadError}
      <div class="error">
        <strong>Failed to load.</strong>
        <p>{loadError}</p>
        <p class="muted small">Check the Pages worker secrets (<code>WEB_AUTH_SECRET</code>, <code>WORKER_API_BASE</code>) and the worker logs (<code>npx wrangler tail superconnector-pages</code>).</p>
      </div>
    {:else if view}
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
  .error {
    background: #fff4f4;
    border: 1px solid #f0c0c0;
    border-radius: 8px;
    padding: 16px;
    color: #7a1e1e;
    max-width: 720px;
  }
  .error code {
    background: rgba(0,0,0,0.04);
    padding: 0 4px;
    border-radius: 3px;
  }
  .mobile-back { display: none; align-self: flex-start; margin-bottom: 12px; }

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { display: none; }
    .content { padding: 16px; }
    .mobile-back { display: inline-flex; }
  }
</style>
