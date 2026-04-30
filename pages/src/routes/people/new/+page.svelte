<script lang="ts">
  import { goto } from '$app/navigation';
  import ChatPane from '$components/ChatPane.svelte';
  import Icon from '$components/Icon.svelte';
  import { ulid } from '$lib/ulid';

  // One-shot thread for "new person from freeform". The chat backend handles
  // scope='new-person' specially: it tells the LLM to call add_person + dictate,
  // and emits a person_created SSE event that we use to redirect.
  let threadId = $state(ulid());

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
  <header class="hd">
    <a href="/people" class="btn small back-link">
      <Icon name="arrow-left" size={14} /> people
    </a>
    <h1>Add a person</h1>
    <p class="muted small intro">
      Type freeform — name, email, what they do, what they need, what they can
      offer. The assistant will create the record and apply structured
      updates, then drop you on their profile.
    </p>
  </header>
  <div class="chatbox">
    <ChatPane scope="new-person" {threadId} {onPersonCreated} />
  </div>
</div>

<style>
  .layout {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100%;
    width: 100%;
    max-width: 720px;
    margin: 0 auto;
    padding: 16px;
    gap: 12px;
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
    .layout { padding: 12px; }
    .hd h1 { font-size: 18px; }
  }
</style>
