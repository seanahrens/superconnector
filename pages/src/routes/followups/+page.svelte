<script lang="ts">
  import { api } from '$lib/api';
  import type { FollowupItem } from '$lib/types';

  let items = $state<FollowupItem[]>([]);
  let loading = $state(true);
  let status = $state<'open' | 'done' | 'dropped'>('open');

  async function load() {
    loading = true;
    const { items: data } = await api.get<{ items: FollowupItem[] }>(`/api/followups?status=${status}`);
    items = data;
    loading = false;
  }
  $effect(() => { void status; load(); });

  async function complete(id: string, next: 'done' | 'dropped') {
    await api.post(`/api/followups/${id}/complete`, { status: next });
    await load();
  }
</script>

<div class="content">
  <header class="row">
    <h2>Followups</h2>
    <span class="spacer"></span>
    <select bind:value={status}>
      <option value="open">open</option>
      <option value="done">done</option>
      <option value="dropped">dropped</option>
    </select>
  </header>

  {#if loading}
    <p class="muted">loading…</p>
  {:else if items.length === 0}
    <p class="muted">No {status} followups.</p>
  {:else}
    <ul class="list">
      {#each items as f}
        <li>
          <div class="col">
            <div>
              <a href={`/people/${f.person_id}`}>{f.display_name ?? '(unknown)'}</a>
              {#if f.due_date}<span class="muted small">due {f.due_date}</span>{/if}
            </div>
            <div>{f.body}</div>
          </div>
          {#if status === 'open'}
            <span class="spacer"></span>
            <button class="btn btn-primary" onclick={() => complete(f.id, 'done')}>done</button>
            <button class="btn" onclick={() => complete(f.id, 'dropped')}>drop</button>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .content { padding: 24px; overflow-y: auto; max-width: 920px; }
  h2 { margin: 0; }
  .list {
    list-style: none;
    padding: 0;
    margin: 16px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .list li {
    padding: 12px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: white;
    display: flex;
    align-items: center;
    gap: 12px;
  }
</style>
