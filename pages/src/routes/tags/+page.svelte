<script lang="ts">
  import { api } from '$lib/api';
  import type { TagRow, TagProposal } from '$lib/types';
  import Icon from '$components/Icon.svelte';

  interface PersonHit {
    person_id: string;
    display_name: string | null;
    primary_email: string | null;
  }
  interface TagDetail {
    tag: TagRow;
    people: PersonHit[];
  }

  let tags = $state<TagRow[]>([]);
  let proposals = $state<TagProposal[]>([]);
  let loading = $state(true);

  // Selected tag: either a real tag (for editing) or the "proposals" view.
  type View = { kind: 'tag'; id: string } | { kind: 'proposals' };
  let view = $state<View>({ kind: 'proposals' });

  let detail = $state<TagDetail | null>(null);
  let detailLoading = $state(false);
  let editName = $state('');
  let editCategory = $state<string>('free');
  let saving = $state(false);
  let detailError = $state<string | null>(null);

  async function load() {
    loading = true;
    try {
      const [{ tags: t }, { proposals: p }] = await Promise.all([
        api.get<{ tags: TagRow[] }>(`/api/tags`),
        api.get<{ proposals: TagProposal[] }>(`/api/tags/proposals`),
      ]);
      tags = t;
      proposals = p;
    } finally {
      loading = false;
    }
  }
  $effect(() => { void load(); });

  $effect(() => {
    if (view.kind === 'tag') {
      void loadDetail(view.id);
    } else {
      detail = null;
    }
  });

  async function loadDetail(id: string) {
    detailLoading = true;
    detailError = null;
    try {
      const r = await api.get<TagDetail>(`/api/tags/${encodeURIComponent(id)}`);
      detail = r;
      editName = r.tag.name;
      editCategory = r.tag.category ?? 'free';
    } catch (err) {
      detailError = (err as Error).message;
    } finally {
      detailLoading = false;
    }
  }

  async function saveTag() {
    if (!detail) return;
    saving = true;
    detailError = null;
    try {
      const r = await api.patch<{ ok: true; merged_into?: string; id?: string; name?: string }>(
        `/api/tags/${encodeURIComponent(detail.tag.id)}`,
        { name: editName, category: editCategory },
      );
      await load();
      if (r.merged_into) {
        view = { kind: 'tag', id: r.merged_into };
      } else if (detail) {
        await loadDetail(detail.tag.id);
      }
    } catch (err) {
      detailError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function deleteTag() {
    if (!detail) return;
    if (!confirm(`Delete "${detail.tag.name}"? It'll be removed from ${detail.people.length} ${detail.people.length === 1 ? 'person' : 'people'}.`)) return;
    saving = true;
    detailError = null;
    try {
      await api.delete(`/api/tags/${encodeURIComponent(detail.tag.id)}`);
      await load();
      view = { kind: 'proposals' };
    } catch (err) {
      detailError = (err as Error).message;
    } finally {
      saving = false;
    }
  }

  async function review(id: string, decision: 'accept' | 'merge' | 'reject', extra: Record<string, unknown> = {}) {
    await api.post(`/api/tags/proposals/${id}/review`, { decision, ...extra });
    await load();
  }

  let mergeTarget = $state<Record<string, string>>({});

  // Active id helper for sidebar list highlighting.
  const selectedId = $derived(view.kind === 'tag' ? view.id : null);
</script>

<div class="layout">
  <aside class="sidebar">
    <div class="sidebar-top">
      <h3 class="hd">Tags <span class="muted small">({tags.length})</span></h3>
      <p class="muted small intro">
        Click a tag to rename or delete. Tap “Proposals” to triage suggestions
        the LLM has made during ingest.
      </p>
    </div>

    <div class="sidebar-list">
      <button
        class="row"
        class:active={view.kind === 'proposals'}
        onclick={() => (view = { kind: 'proposals' })}
      >
        <Icon name="list-todo" size={14} />
        <span class="row-label">Proposals</span>
        <span class="count">{proposals.length}</span>
      </button>

      <hr class="rule" />

      {#if loading}
        <div class="muted small">loading…</div>
      {:else if tags.length === 0}
        <div class="muted small">no tags yet</div>
      {:else}
        {#each tags as t (t.id)}
          <button
            class="row"
            class:active={selectedId === t.id}
            onclick={() => (view = { kind: 'tag', id: t.id })}
          >
            <Icon name="tag" size={14} />
            <span class="row-label">{t.name}</span>
            <span class="muted small count">{t.use_count}</span>
          </button>
        {/each}
      {/if}
    </div>
  </aside>

  <section class="content">
    {#if view.kind === 'proposals'}
      <h2>Proposals <span class="muted">({proposals.length})</span></h2>
      <p class="muted small intro">
        During ingest the extraction LLM suggests new tags it thinks should
        exist (e.g. <em>trajectory/raising seed</em> emerging from a meeting).
        Until you accept one here, it doesn't enter the canonical tag set.
      </p>
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
                <button class="btn" onclick={() => review(p.id, 'merge', { merge_into_tag_name: mergeTarget[p.id] })} disabled={!mergeTarget[p.id]}>merge</button>
                <button class="btn btn-danger" onclick={() => review(p.id, 'reject')}>reject</button>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      {#if detailLoading}
        <p class="muted">loading…</p>
      {:else if detail}
        <h2>{detail.tag.name}</h2>
        <p class="muted small intro">
          Used by {detail.people.length} {detail.people.length === 1 ? 'person' : 'people'}.
          Renaming to an existing tag merges the two.
        </p>

        <div class="card">
          <div class="field">
            <div class="label">Name</div>
            <input bind:value={editName} placeholder="e.g. ai safety" />
          </div>
          <div class="field">
            <div class="label">Category</div>
            <select bind:value={editCategory}>
              <option value="free">free</option>
              <option value="trajectory">trajectory</option>
              <option value="topic">topic</option>
              <option value="skill">skill</option>
            </select>
          </div>
          {#if detailError}<div class="error">{detailError}</div>{/if}
          <div class="actions">
            <button class="btn btn-primary" onclick={saveTag} disabled={saving || !editName.trim()}>
              {saving ? 'saving…' : 'Save'}
            </button>
            <span class="spacer"></span>
            <button class="btn btn-danger" onclick={deleteTag} disabled={saving}>
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
        </div>

        <div class="card">
          <div class="label">People with this tag</div>
          {#if detail.people.length === 0}
            <p class="muted small">No one currently has this tag.</p>
          {:else}
            <ul class="people">
              {#each detail.people as p (p.person_id)}
                <li>
                  <a href={`/people/${p.person_id}`}>{p.display_name ?? '(unnamed)'}</a>
                  {#if p.primary_email}<span class="muted small"> · {p.primary_email}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {:else}
        <p class="muted">Pick a tag.</p>
      {/if}
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
    display: grid;
    grid-template-rows: auto 1fr;
    min-height: 0;
  }
  .sidebar-top { padding: 12px; }
  .sidebar-list { overflow-y: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 2px; }
  .hd { margin: 0 0 4px; font-size: 14px; }
  .intro { margin: 0; }

  .row {
    width: 100%;
    text-align: left;
    background: white;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 10px;
    display: flex;
    align-items: center;
    gap: 8px;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .row:hover { background: var(--hover); }
  .row.active { background: var(--hover); border-color: var(--border); color: var(--accent); }
  .row-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .count {
    font-size: 11px;
    color: var(--muted);
    background: var(--hover);
    border-radius: 999px;
    padding: 1px 6px;
    font-variant-numeric: tabular-nums;
  }
  .row.active .count { background: rgba(67, 56, 202, 0.10); color: var(--accent); }
  .rule { border: 0; border-top: 1px solid var(--border); margin: 8px 0; }

  .content { padding: 24px; overflow-y: auto; max-width: 920px; }
  .content h2 { margin: 0 0 4px; }
  .intro { max-width: 60ch; }

  .card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    margin-top: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .field { display: flex; flex-direction: column; gap: 4px; }
  .label {
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--muted);
  }
  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .error { color: #7a1e1e; background: #fff4f4; border: 1px solid #f0c0c0; border-radius: 6px; padding: 8px; font-size: 13px; }
  .people { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  .people li { padding: 6px 0; }

  .proposals {
    list-style: none;
    padding: 0;
    margin: 16px 0 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .proposals li { padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: white; }
  .row { display: flex; align-items: center; gap: 8px; }

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    .sidebar { border-right: 0; border-bottom: 1px solid var(--border); max-height: 38vh; }
    .content { padding: 16px; }
  }
</style>
