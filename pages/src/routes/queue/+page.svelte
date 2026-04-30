<script lang="ts">
  import { api } from '$lib/api';
  import type { ConfirmationItem } from '$lib/types';

  // Payload shapes the backend writes for each queue kind.
  interface NoteForQueue {
    id: string;
    title: string | null;
    web_url?: string | null;
    owner?: { name: string | null; email: string | null };
    created_at: string;
    summary: string | null;
    transcript_preview: string | null;
  }
  interface MeetingClassificationPayload {
    note: NoteForQueue;
    event_title: string | null;
    attendees: Array<{ email: string | null; name: string | null }>;
    classifier_reason: string;
  }
  interface PersonResolutionPayload {
    note?: NoteForQueue;
    attendee: { email: string | null; name: string | null } | null;
    candidates?: Array<{ id: string; display_name: string | null; primary_email: string | null }>;
    reason?: string;
  }

  let items = $state<ConfirmationItem[]>([]);
  let loading = $state(true);
  let selected = $state<ConfirmationItem | null>(null);

  async function load() {
    loading = true;
    const { items: data } = await api.get<{ items: ConfirmationItem[] }>(`/api/queue?status=pending`);
    items = data;
    if (selected) {
      selected = items.find((i) => i.id === selected!.id) ?? items[0] ?? null;
    } else {
      selected = items[0] ?? null;
    }
    loading = false;
  }
  $effect(() => { load(); });

  async function resolve(decision: 'resolve' | 'dismiss', extra: Record<string, unknown> = {}) {
    if (!selected) return;
    await api.post(`/api/queue/${selected.id}/resolve`, { decision, ...extra });
    selected = null;
    await load();
  }

  async function clearAll() {
    if (!confirm(`Dismiss all ${items.length} pending items?`)) return;
    await api.post('/api/admin/clear-queue', {});
    await load();
  }

  function payload<T>(item: ConfirmationItem): T {
    return item.payload as T;
  }

  function listLabel(item: ConfirmationItem): string {
    const p = item.payload as { note?: { title?: string | null } } | undefined;
    const t = p?.note?.title?.trim();
    if (t) return t;
    return item.kind.replace(/_/g, ' ');
  }

  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtDateTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }
</script>

<div class="layout">
  <aside class="sidebar">
    <div class="header">
      <span class="muted small">{items.length} pending</span>
      {#if items.length > 0}
        <button class="link small" onclick={clearAll}>clear all</button>
      {/if}
    </div>
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
              <div class="title">{listLabel(item)}</div>
              <div class="muted small">
                <span class="kind">{item.kind.replace(/_/g, ' ')}</span>
                <span> · {fmtDate(item.created_at)}</span>
              </div>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="content">
    {#if !selected}
      <div class="muted">Pick an item.</div>
    {:else if selected.kind === 'meeting_classification'}
      {@const p = payload<MeetingClassificationPayload>(selected)}
      <header class="head">
        <h2>{p.note?.title ?? '(untitled note)'}</h2>
        <div class="meta muted small">
          {#if p.note?.owner?.name}{p.note.owner.name} · {/if}
          {fmtDateTime(p.note.created_at)}
          {#if p.note?.web_url}
            · <a href={p.note.web_url} target="_blank" rel="noopener">open in Granola ↗</a>
          {/if}
        </div>
      </header>

      <div class="grid">
        <div class="field">
          <div class="label">Event title</div>
          <div>{p.event_title ?? '—'}</div>
        </div>
        <div class="field">
          <div class="label">Attendees (calendar)</div>
          {#if p.attendees.length === 0}
            <div class="muted">none matched</div>
          {:else}
            <ul class="inline">
              {#each p.attendees as a}
                <li>{a.name ?? a.email}{a.email && a.name ? ` <${a.email}>` : ''}</li>
              {/each}
            </ul>
          {/if}
        </div>
        <div class="field">
          <div class="label">Why ambiguous</div>
          <div>{p.classifier_reason}</div>
        </div>
      </div>

      {#if p.note?.summary}
        <div class="field">
          <div class="label">Summary</div>
          <div class="prose">{p.note.summary}</div>
        </div>
      {/if}

      {#if p.note?.transcript_preview}
        <div class="field">
          <div class="label">Transcript (preview)</div>
          <pre class="transcript">{p.note.transcript_preview}</pre>
        </div>
      {/if}

      <div class="actions">
        <button class="btn btn-primary" onclick={() => resolve('resolve', { classification: '1:1' })}>1:1</button>
        <button class="btn" onclick={() => resolve('resolve', { classification: 'group' })}>group (skip)</button>
        <button class="btn" onclick={() => resolve('dismiss')}>dismiss</button>
      </div>

    {:else if selected.kind === 'person_resolution'}
      {@const p = payload<PersonResolutionPayload>(selected)}
      <header class="head">
        <h2>{p.note?.title ?? 'Person resolution'}</h2>
        <div class="meta muted small">
          {#if p.note?.created_at}{fmtDateTime(p.note.created_at)}{/if}
          {#if p.note?.web_url}
            · <a href={p.note.web_url} target="_blank" rel="noopener">open in Granola ↗</a>
          {/if}
        </div>
      </header>

      <div class="field">
        <div class="label">Attendee from source</div>
        {#if p.attendee?.email || p.attendee?.name}
          <div>{p.attendee.name ?? ''} {p.attendee.email ? `<${p.attendee.email}>` : ''}</div>
        {:else}
          <div class="muted">{p.reason ?? 'no attendee info'}</div>
        {/if}
      </div>

      {#if p.note?.summary}
        <div class="field">
          <div class="label">Summary</div>
          <div class="prose">{p.note.summary}</div>
        </div>
      {/if}

      <div class="actions">
        {#if p.candidates?.length}
          <div class="label">Candidates</div>
          {#each p.candidates as c}
            <button class="btn" onclick={() => resolve('resolve', { selected_person_id: c.id })}>
              pick {c.display_name ?? c.primary_email ?? c.id}
            </button>
          {/each}
        {/if}
        <button class="btn" onclick={() => resolve('dismiss')}>dismiss</button>
      </div>

    {:else if selected.kind === 'extraction_review'}
      <header class="head"><h2>Extraction review</h2></header>
      <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
      <div class="actions">
        <button class="btn btn-primary" onclick={() => resolve('resolve', { accept_extraction: true })}>accept</button>
        <button class="btn" onclick={() => resolve('dismiss')}>reject</button>
      </div>

    {:else}
      <header class="head"><h2>{selected.kind}</h2></header>
      <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
      <div class="actions">
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
  .header { display: flex; align-items: center; justify-content: space-between; padding: 4px 6px; }
  .link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
  }
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
  .title { font-weight: 500; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kind { text-transform: capitalize; }
  .content { padding: 24px 32px; overflow-y: auto; }
  .head h2 { margin: 0 0 4px; }
  .meta { margin-bottom: 16px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .field { margin-bottom: 16px; }
  .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-bottom: 4px; }
  .inline { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .prose { white-space: pre-wrap; line-height: 1.5; }
  .transcript {
    background: var(--hover);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    max-height: 50vh;
    font-size: 12px;
    line-height: 1.5;
    white-space: pre-wrap;
  }
  pre {
    background: var(--hover);
    padding: 12px;
    border-radius: 6px;
    overflow-x: auto;
    max-height: 60vh;
  }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 16px; align-items: center; }
</style>
