<script lang="ts">
  import { api } from '$lib/api';
  import type { FollowupItem } from '$lib/types';
  import EditableField from '$components/EditableField.svelte';
  import { fmtShortDate } from '$lib/dates';

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

  async function setStatus(id: string, next: 'open' | 'done' | 'dropped') {
    await api.post(`/api/followups/${id}/complete`, { status: next });
    await load();
  }
  async function saveBody(id: string, body: string) {
    await api.patch(`/api/followups/${id}`, { body });
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
      {#each items as f (f.id)}
        <li>
          <div class="col">
            <div>
              <a href={`/people/${f.person_id}`}>{f.display_name ?? '(unknown)'}</a>
              {#if f.due_date}<span class="muted small">due {fmtShortDate(f.due_date)}</span>{/if}
            </div>
            <div class="body">
              <EditableField
                value={f.body}
                multiline
                placeholder="(empty)"
                label="Edit followup"
                onSave={(next) => saveBody(f.id, next)}
              />
            </div>
          </div>
          <span class="spacer"></span>
          {#if status === 'open'}
            <button class="btn btn-primary" onclick={() => setStatus(f.id, 'done')}>done</button>
            <button class="btn" onclick={() => setStatus(f.id, 'dropped')}>drop</button>
          {:else}
            <button class="btn" onclick={() => setStatus(f.id, 'open')}>re-open</button>
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
    flex-wrap: wrap;
  }
  @media (max-width: 720px) {
    .content { padding: 16px; width: 100%; }
    .list li { gap: 8px; }
    .list li > .col { flex: 1 1 100%; }
  }
</style>
