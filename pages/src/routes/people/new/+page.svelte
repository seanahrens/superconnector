<script lang="ts">
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import type { PersonListItem } from '$lib/types';
  import ChatPane from '$components/ChatPane.svelte';
  import Icon from '$components/Icon.svelte';
  import PeopleList from '$components/PeopleList.svelte';
  import { ulid } from '$lib/ulid';

  // One-shot thread for "new person from freeform". The chat backend handles
  // scope='new-person' specially: it tells the LLM to call add_person + dictate,
  // and emits a person_created SSE event that we use to redirect.
  let threadId = $state(ulid());

  // Mirror the /people page's left-pane list so we keep context while adding.
  let items = $state<PersonListItem[]>([]);
  let loadingList = $state(true);

  $effect(() => { void loadList(); });
  async function loadList() {
    loadingList = true;
    try {
      const { items: data } = await api.get<{ items: PersonListItem[] }>(`/api/people?sort=magical&limit=200`);
      items = data;
    } finally {
      loadingList = false;
    }
  }

  function onPersonCreated(id: string) {
    // Tiny delay so the assistant's confirming text streams in before we
    // navigate; not strictly required but reads nicer.
    setTimeout(() => goto(`/people/${id}`), 600);
  }
</script>

<svelte:head>
  <title>Add person · superconnector</title>
</svelte:head>

<div class="layout">
  <aside class="sidebar">
    <div class="muted small" style="padding: 4px 6px">{items.length} people</div>
    <PeopleList
      {items}
      loading={loadingList}
      activeId={null}
      reorderable={false}
      onSelect={(id) => goto(`/people/${id}`)}
    />
  </aside>
  <section class="content">
    <header class="hd">
      <a href="/people" class="btn small back-link">
        <Icon name="arrow-left" size={14} /> people
      </a>
      <h1>Add a person</h1>
      <p class="muted small intro">
        Type freeform — name, email, what they do, what they need, what they
        can offer. The assistant creates the record and applies structured
        updates, then drops you on their profile.
      </p>
    </header>
    <div class="chatbox">
      <ChatPane scope="new-person" {threadId} {onPersonCreated} />
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
  }
  .content {
    overflow: hidden;
    padding: 24px;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 12px;
    max-width: 760px;
    min-height: 0;
  }
  .hd { display: flex; flex-direction: column; gap: 6px; }
  .hd h1 { margin: 0; font-size: 22px; }
  .back-link { align-self: flex-start; }
  .intro { max-width: 60ch; margin: 4px 0 0; }
  .chatbox {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: white;
    overflow: hidden;
    min-height: 0;
  }

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { display: none; }
    .content { padding: 12px; }
    .hd h1 { font-size: 18px; }
  }
</style>
