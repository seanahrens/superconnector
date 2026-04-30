<script lang="ts">
  import { api } from '$lib/api';
  import type { TagRow, TagProposal } from '$lib/types';

  let tags = $state<TagRow[]>([]);
  let proposals = $state<TagProposal[]>([]);
  let loading = $state(true);

  async function load() {
    loading = true;
    const [{ tags: t }, { proposals: p }] = await Promise.all([
      api.get<{ tags: TagRow[] }>(`/api/tags`),
      api.get<{ proposals: TagProposal[] }>(`/api/tags/proposals`),
    ]);
    tags = t;
    proposals = p;
    loading = false;
  }
  $effect(() => { load(); });

  async function review(id: string, decision: 'accept' | 'merge' | 'reject', extra: Record<string, unknown> = {}) {
    await api.post(`/api/tags/proposals/${id}/review`, { decision, ...extra });
    await load();
  }

  let mergeTarget = $state<Record<string, string>>({});
</script>

<div class="layout">
  <aside class="sidebar">
    <h3>Existing tags ({tags.length})</h3>
    {#if loading}
      <div class="muted small">loading…</div>
    {/if}
    <ul class="list">
      {#each tags as t}
        <li>
          <span class="chip">{t.name}</span>
          <span class="muted small">{t.category ?? 'free'} · used {t.use_count}×</span>
        </li>
      {/each}
    </ul>
  </aside>

  <section class="content">
    <h2>Proposals ({proposals.length})</h2>
    {#if proposals.length === 0}
      <p class="muted">No pending proposals.</p>
    {:else}
      <ul class="proposals">
        {#each proposals as p}
          <li>
            <div class="row">
              <strong>{p.proposed_name}</strong>
              <span class="muted small">{p.proposed_category ?? 'free'}</span>
              <span class="muted small">{p.created_at.slice(0, 10)}</span>
            </div>
            <div class="actions">
              <button class="btn btn-primary" onclick={() => review(p.id, 'accept')}>accept</button>
              <input
                placeholder="merge into…"
                bind:value={mergeTarget[p.id]}
                list="tag-options-{p.id}"
              />
              <datalist id="tag-options-{p.id}">
                {#each tags as t}<option value={t.name}></option>{/each}
              </datalist>
              <button class="btn" onclick={() => review(p.id, 'merge', { merge_into_tag_name: mergeTarget[p.id] })} disabled={!mergeTarget[p.id]}>
                merge
              </button>
              <button class="btn btn-danger" onclick={() => review(p.id, 'reject')}>reject</button>
            </div>
          </li>
        {/each}
      </ul>
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
  .sidebar h3 { margin: 0 0 8px 0; font-size: 14px; }
  .sidebar .list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .content { padding: 24px; overflow-y: auto; }
  .proposals {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .proposals li { padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: white; }
  .actions { display: flex; gap: 8px; align-items: center; margin-top: 8px; flex-wrap: wrap; }

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    /* Existing tags become a collapsible-feeling header strip on top with
       horizontal scroll, so the proposals (the actionable content) get the
       focus. */
    .sidebar {
      border-right: 0;
      border-bottom: 1px solid var(--border);
      max-height: 38vh;
      padding: 12px;
    }
    .sidebar .list { flex-direction: row; flex-wrap: wrap; }
    .content { padding: 16px; }
    .actions input { flex: 1 1 100%; }
  }
</style>
