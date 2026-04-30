<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import ChatPane from '$components/ChatPane.svelte';
  import Icon from '$components/Icon.svelte';
  import { ulid } from '$lib/ulid';

  // The People list lives in /people/+layout.svelte; this page just hosts
  // the freeform chat that creates a person and redirects on completion.
  // If we arrived via the AddPersonModal, the user's text comes in as a
  // ?seed=<…> URL parameter and we auto-submit it as the first message so
  // they don't have to press send a second time.

  let threadId = $state(ulid());
  const seed = $derived($page.url.searchParams.get('seed') ?? undefined);

  function onPersonCreated(id: string) {
    setTimeout(() => goto(`/people/${id}`), 600);
  }
</script>

<svelte:head>
  <title>Add person · superconnector</title>
</svelte:head>

<div class="page">
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
    <ChatPane
      scope="new-person"
      {threadId}
      initialInput={seed}
      autoSend={!!seed}
      {onPersonCreated}
    />
  </div>
</div>

<style>
  .page {
    padding: 24px;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 12px;
    max-width: 760px;
    height: 100%;
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
    .page { padding: 12px; }
    .hd h1 { font-size: 18px; }
  }
</style>
