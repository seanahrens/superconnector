<script lang="ts">
  import { api } from '$lib/api';
  import type { ConfirmationItem } from '$lib/types';

  let items = $state<ConfirmationItem[]>([]);
  let loading = $state(true);
  let selected = $state<ConfirmationItem | null>(null);

  async function load() {
    loading = true;
    const { items: data } = await api.get<{ items: ConfirmationItem[] }>(`/api/queue?status=pending`);
    items = data;
    selected = items[0] ?? null;
    loading = false;
  }
  $effect(() => { load(); });

  async function resolve(decision: 'resolve' | 'dismiss', extra: Record<string, unknown> = {}) {
    if (!selected) return;
    await api.post(`/api/queue/${selected.id}/resolve`, { decision, ...extra });
    await load();
  }

  function payloadAs<T>(p: unknown): T { return p as T; }
</script>

<div class="layout">
  <aside class="sidebar">
    <div class="muted small" style="padding: 4px 6px">{items.length} pending</div>
    {#if loading}
      <div class="muted small">loading…</div>
    {:else if items.length === 0}
      <div class="muted small">queue is empty</div>
    {:else}
      <ul class="list">
        {#each items as item (item.id)}
          <li>
            <button
              class:active={selected?.id === item.id}
              onclick={() => (selected = item)}
            >
              <div class="kind">{item.kind}</div>
              <div class="muted small">{item.created_at.slice(0, 10)}</div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="content">
    {#if !selected}
      <div class="muted">Pick an item.</div>
    {:else}
      <h2>{selected.kind}</h2>
      <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
      <div class="actions">
        {#if selected.kind === 'extraction_review'}
          <button class="btn btn-primary" onclick={() => resolve('resolve', { accept_extraction: true })}>accept extraction</button>
        {:else if selected.kind === 'person_resolution'}
          {@const payload = payloadAs<{ candidates?: Array<{ id: string; display_name: string | null }>; }>(selected.payload)}
          {#each payload.candidates ?? [] as c}
            <button class="btn" onclick={() => resolve('resolve', { selected_person_id: c.id })}>
              pick {c.display_name ?? c.id}
            </button>
          {/each}
        {:else if selected.kind === 'meeting_classification'}
          <button class="btn" onclick={() => resolve('resolve', { classification: '1:1' })}>1:1</button>
          <button class="btn" onclick={() => resolve('resolve', { classification: 'group' })}>group (skip)</button>
        {/if}
        <button class="btn" onclick={() => resolve('dismiss')}>dismiss</button>
      </div>
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
  .sidebar { border-right: 1px solid var(--border); background: white; overflow-y: auto; padding: 12px; }
  .list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .list button {
    width: 100%;
    text-align: left;
    background: white;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 10px;
  }
  .list button:hover { background: var(--hover); }
  .list button.active { background: var(--hover); border-color: var(--border); }
  .kind { font-weight: 500; text-transform: capitalize; }
  .content { padding: 24px; overflow-y: auto; }
  pre {
    background: var(--hover);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    max-height: 60vh;
  }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; }
</style>
