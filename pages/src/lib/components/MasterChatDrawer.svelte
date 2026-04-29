<script lang="ts">
  import { api } from '$lib/api';
  import { ulid } from '$lib/ulid';
  import ChatPane from './ChatPane.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();
  let threadId = $state<string | null>(null);

  function newThread() {
    threadId = ulid();
  }
</script>

{#if open}
  <button class="scrim" onclick={() => (open = false)} aria-label="close"></button>
  <aside class="drawer">
    <div class="hd">
      <strong>Master chat</strong>
      <span class="spacer"></span>
      <button class="btn" onclick={newThread}>new</button>
      <button class="btn" onclick={() => (open = false)}>×</button>
    </div>
    <div class="body">
      {#if threadId}
        <ChatPane scope="global" {threadId} />
      {:else}
        <div class="empty">
          <p>Ask anything across your data — searches, matches, drafts, dictation, SQL.</p>
          <button class="btn btn-primary" onclick={newThread}>start a thread</button>
        </div>
      {/if}
    </div>
  </aside>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.25);
    z-index: 90;
    border: 0;
    padding: 0;
    cursor: default;
  }
  .drawer {
    position: fixed;
    right: 0;
    top: 0;
    bottom: 0;
    width: min(560px, 100vw);
    background: var(--bg);
    border-left: 1px solid var(--border);
    z-index: 100;
    display: grid;
    grid-template-rows: auto 1fr;
    box-shadow: -8px 0 32px rgba(0,0,0,0.08);
  }
  .hd {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: white;
  }
  .body {
    overflow: hidden;
  }
  .empty {
    padding: 32px 24px;
    text-align: center;
    color: var(--muted);
  }
</style>
