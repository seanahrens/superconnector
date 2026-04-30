<script lang="ts">
  import { api } from '$lib/api';
  import type { ChatThread } from '$lib/types';
  import { ulid } from '$lib/ulid';
  import ChatPane from './ChatPane.svelte';

  let { open = $bindable(false) }: { open: boolean } = $props();
  let threadId = $state<string | null>(null);
  let seed = $state<string | undefined>(undefined);
  let recent = $state<ChatThread[]>([]);
  let loading = $state(false);
  let lastOpened = $state(false);

  $effect(() => {
    if (open && !lastOpened) {
      lastOpened = true;
      void loadThreads();
    }
    if (!open) {
      lastOpened = false;
    }
  });

  async function loadThreads() {
    loading = true;
    try {
      const { threads } = await api.get<{ threads: ChatThread[] }>(`/api/chat/threads?scope=global`);
      recent = threads;
    } catch {
      recent = [];
    } finally {
      loading = false;
    }
  }

  function newThread() {
    seed = undefined;
    threadId = ulid();
  }

  function resume(id: string) {
    seed = undefined;
    threadId = id;
  }

  function startWith(text: string) {
    seed = text;
    threadId = ulid();
  }

  function backToList() {
    threadId = null;
    void loadThreads();
  }
</script>

{#if open}
  <button class="scrim" onclick={() => (open = false)} aria-label="close"></button>
  <aside class="drawer">
    <div class="hd">
      <strong>Master chat</strong>
      <span class="spacer"></span>
      {#if threadId}
        <button class="btn" onclick={backToList}>threads</button>
      {/if}
      <button class="btn" onclick={newThread}>new</button>
      <button class="btn" onclick={() => (open = false)}>×</button>
    </div>
    <div class="body">
      {#if threadId}
        <ChatPane scope="global" {threadId} initialInput={seed} />
      {:else}
        <div class="empty">
          <p>Ask anything across your data — searches, matches, drafts, dictation, SQL.</p>
          <button class="btn btn-primary" onclick={newThread}>start a thread</button>

          {#if loading}
            <p class="muted">Loading recent threads…</p>
          {:else if recent.length}
            <p class="examples-label">Recent threads</p>
            <ul class="examples">
              {#each recent.slice(0, 8) as t (t.id)}
                <li>
                  <button class="example" onclick={() => resume(t.id)}>
                    <span class="thread-title">{t.title ?? '(untitled)'}</span>
                    <span class="thread-when">{t.updated_at.slice(0, 10)}</span>
                  </button>
                </li>
              {/each}
            </ul>
          {/if}

          <p class="examples-label">Examples</p>
          <ul class="examples">
            <li><button class="example" onclick={() => startWith("who's a good cofounder for Sarah Chen?")}>who's a good cofounder for Sarah Chen?</button></li>
            <li><button class="example" onclick={() => startWith('show me funders interested in evals')}>show me funders interested in evals</button></li>
            <li><button class="example" onclick={() => startWith("who haven't I met with in 60+ days but is tagged active?")}>who haven't I met with in 60+ days but is tagged active?</button></li>
            <li><button class="example" onclick={() => startWith('draft an intro between Alex Smith and Priya Patel')}>draft an intro between Alex Smith and Priya Patel</button></li>
            <li><button class="example" onclick={() => startWith('what should I send Sarah after our last meeting?')}>what should I send Sarah after our last meeting?</button></li>
          </ul>
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
    /* Respect iOS safe areas when drawer goes edge-to-edge on mobile. */
    padding-top: var(--safe-top);
    padding-bottom: var(--safe-bottom);
  }
  @media (max-width: 720px) {
    .drawer {
      width: 100vw;
      border-left: 0;
    }
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
  .examples-label {
    margin: 24px 0 8px;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
  }
  .examples {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
    text-align: left;
  }
  .examples li { margin: 0; }
  .example {
    width: 100%;
    text-align: left;
    background: white;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 12px;
    font: inherit;
    color: inherit;
    cursor: pointer;
  }
  .example:hover {
    background: var(--hover);
  }
  .thread-title {
    display: block;
    font-weight: 500;
    color: var(--text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .thread-when {
    display: block;
    font-size: 11px;
    color: var(--muted);
    margin-top: 2px;
  }
</style>
