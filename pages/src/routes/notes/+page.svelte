<script lang="ts">
  import { api } from '$lib/api';
  import type { ConfirmationItem } from '$lib/types';
  import Icon from '$components/Icon.svelte';

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
    resolved_person_id?: string;
    resolved_meeting_id?: string;
  }
  interface PersonResolutionPayload {
    note?: NoteForQueue;
    attendee: { email: string | null; name: string | null } | null;
    candidates?: Array<{ id: string; display_name: string | null; primary_email: string | null }>;
    reason?: string;
    resolved_person_id?: string;
    resolved_meeting_id?: string;
  }
  interface ProcessedItem {
    meeting_id: string;
    note_id: string | null;
    recorded_at: string;
    event_title: string | null;
    classification: string;
    summary: string | null;
    person_id: string | null;
    display_name: string | null;
    primary_email: string | null;
  }

  type Tab = 'pending' | 'processed' | 'dismissed';

  let tab = $state<Tab>('pending');
  let pending = $state<ConfirmationItem[]>([]);
  let dismissed = $state<ConfirmationItem[]>([]);
  let processed = $state<ProcessedItem[]>([]);
  let counts = $state({ pending: 0, processed: 0, dismissed: 0 });
  let loading = $state(true);
  let selected = $state<ConfirmationItem | null>(null);
  let counterpartName = $state('');
  let counterpartEmail = $state('');
  let resolveError = $state<string | null>(null);
  let resolving = $state(false);

  async function loadAll() {
    const [p, d, pr] = await Promise.all([
      api.get<{ items: ConfirmationItem[] }>('/api/queue?status=pending'),
      api.get<{ items: ConfirmationItem[] }>('/api/queue?status=dismissed'),
      api.get<{ items: ProcessedItem[] }>('/api/queue/processed?limit=200'),
    ]);
    pending = p.items;
    dismissed = d.items;
    processed = pr.items;
    counts = { pending: p.items.length, processed: pr.items.length, dismissed: d.items.length };
    if (selected) {
      const list = tab === 'pending' ? pending : tab === 'dismissed' ? dismissed : [];
      selected = list.find((i) => i.id === selected!.id) ?? list[0] ?? null;
    } else if (tab === 'pending') {
      selected = pending[0] ?? null;
    } else if (tab === 'dismissed') {
      selected = dismissed[0] ?? null;
    }
  }

  async function load() {
    loading = true;
    try {
      await loadAll();
    } finally {
      loading = false;
    }
  }
  $effect(() => { load(); });

  $effect(() => {
    void tab;
    counterpartName = '';
    counterpartEmail = '';
    resolveError = null;
    if (tab === 'pending') selected = pending[0] ?? null;
    else if (tab === 'dismissed') selected = dismissed[0] ?? null;
    else selected = null;
  });

  async function resolve(decision: 'resolve' | 'dismiss', extra: Record<string, unknown> = {}) {
    if (!selected) return;
    resolving = true;
    resolveError = null;
    try {
      await api.post(`/api/queue/${selected.id}/resolve`, { decision, ...extra });
      selected = null;
      counterpartName = '';
      counterpartEmail = '';
      await load();
    } catch (err) {
      resolveError = (err as Error).message;
    } finally {
      resolving = false;
    }
  }

  function resolveOneOnOne() {
    const counterpart: Record<string, string> = {};
    if (counterpartName.trim()) counterpart.name = counterpartName.trim();
    if (counterpartEmail.trim()) counterpart.email = counterpartEmail.trim();
    void resolve('resolve', {
      classification: '1:1',
      ...(Object.keys(counterpart).length ? { counterpart } : {}),
    });
  }

  async function clearAll() {
    if (!confirm(`Dismiss all ${pending.length} pending items?`)) return;
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

<div class="layout" data-pane={selected ? 'detail' : 'list'}>
  <aside class="sidebar">
    <div class="tabs">
      <button class="tab" class:active={tab === 'pending'} onclick={() => (tab = 'pending')}>
        Needs review <span class="count">{counts.pending}</span>
      </button>
      <button class="tab" class:active={tab === 'processed'} onclick={() => (tab = 'processed')}>
        Processed <span class="count">{counts.processed}</span>
      </button>
      <button class="tab" class:active={tab === 'dismissed'} onclick={() => (tab = 'dismissed')}>
        Dismissed <span class="count">{counts.dismissed}</span>
      </button>
    </div>

    {#if loading}
      <div class="muted small" style="padding: 8px">loading…</div>
    {:else if tab === 'pending'}
      <div class="header">
        <span class="muted small">{pending.length} pending</span>
        {#if pending.length > 0}
          <button class="link small" onclick={clearAll}>clear all</button>
        {/if}
      </div>
      {#if pending.length === 0}
        <div class="muted small" style="padding: 8px">queue is empty</div>
      {:else}
        <ul class="list">
          {#each pending as item (item.id)}
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
    {:else if tab === 'processed'}
      {#if processed.length === 0}
        <div class="muted small" style="padding: 8px">no notes processed yet</div>
      {:else}
        <ul class="list">
          {#each processed as p (p.meeting_id)}
            <li>
              <a href={p.person_id ? `/people/${p.person_id}` : '#'} class="processed-row">
                <div class="title">{p.display_name ?? p.event_title ?? '(unnamed)'}</div>
                <div class="muted small">
                  <span>{p.classification}</span>
                  <span> · {fmtDate(p.recorded_at)}</span>
                </div>
              </a>
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      {#if dismissed.length === 0}
        <div class="muted small" style="padding: 8px">none dismissed</div>
      {:else}
        <ul class="list">
          {#each dismissed as item (item.id)}
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
    {/if}
  </aside>

  <section class="content">
    {#if selected}
      <button class="mobile-back btn small" onclick={() => (selected = null)}>
        <Icon name="arrow-left" size={14} /> back
      </button>
    {/if}
    {#if tab === 'processed'}
      <div class="muted">Processed notes have been turned into people + meetings. Tap a row to open the person.</div>
    {:else if !selected}
      <div class="muted desktop-only">Pick an item.</div>
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

      {#if tab === 'pending'}
        <div class="resolve-block">
          <div class="label">Resolve as 1:1</div>
          <p class="muted small">
            Calendar didn't surface a counterpart, so we need who this was with.
            We'll either find an existing person or create one.
          </p>
          <div class="row">
            <input
              placeholder="Counterpart name (e.g. Aaron Hamlin)"
              bind:value={counterpartName}
              disabled={resolving}
            />
            <input
              placeholder="email (optional)"
              bind:value={counterpartEmail}
              disabled={resolving}
            />
          </div>
          {#if resolveError}
            <div class="error">{resolveError}</div>
          {/if}
          <div class="actions">
            <button
              class="btn btn-primary"
              onclick={resolveOneOnOne}
              disabled={resolving || (!counterpartName.trim() && !counterpartEmail.trim())}
            >
              {resolving ? 'creating…' : 'create 1:1'}
            </button>
            <button class="btn" onclick={() => resolve('resolve', { classification: 'group' })} disabled={resolving}>group (skip)</button>
            <button class="btn" onclick={() => resolve('dismiss')} disabled={resolving}>dismiss</button>
          </div>
        </div>
      {:else if p.resolved_person_id}
        <div class="muted small">
          → resolved to person <a href={`/people/${p.resolved_person_id}`}>{p.resolved_person_id}</a>
        </div>
      {/if}

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

      {#if tab === 'pending'}
        <div class="resolve-block">
          {#if p.candidates?.length}
            <div class="label">Candidates</div>
            <div class="actions">
              {#each p.candidates as c}
                <button class="btn" onclick={() => resolve('resolve', { selected_person_id: c.id })} disabled={resolving}>
                  pick {c.display_name ?? c.primary_email ?? c.id}
                </button>
              {/each}
            </div>
          {/if}

          <div class="label">Or create a new person</div>
          <div class="row">
            <input placeholder="name" bind:value={counterpartName} disabled={resolving} />
            <input placeholder="email" bind:value={counterpartEmail} disabled={resolving} />
          </div>
          {#if resolveError}
            <div class="error">{resolveError}</div>
          {/if}
          <div class="actions">
            <button
              class="btn btn-primary"
              disabled={resolving || (!counterpartName.trim() && !counterpartEmail.trim())}
              onclick={() => resolve('resolve', { new_person: { name: counterpartName.trim() || undefined, email: counterpartEmail.trim() || undefined } })}
            >
              {resolving ? 'creating…' : 'create + ingest'}
            </button>
            <button class="btn" onclick={() => resolve('dismiss')} disabled={resolving}>dismiss</button>
          </div>
        </div>
      {:else if p.resolved_person_id}
        <div class="muted small">
          → resolved to person <a href={`/people/${p.resolved_person_id}`}>{p.resolved_person_id}</a>
        </div>
      {/if}

    {:else if selected.kind === 'extraction_review'}
      <header class="head"><h2>Extraction review</h2></header>
      <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
      {#if tab === 'pending'}
        <div class="actions">
          <button class="btn btn-primary" onclick={() => resolve('resolve', { accept_extraction: true })} disabled={resolving}>accept</button>
          <button class="btn" onclick={() => resolve('dismiss')} disabled={resolving}>reject</button>
        </div>
      {/if}

    {:else}
      <header class="head"><h2>{selected.kind}</h2></header>
      <pre>{JSON.stringify(selected.payload, null, 2)}</pre>
      {#if tab === 'pending'}
        <div class="actions">
          <button class="btn" onclick={() => resolve('dismiss')} disabled={resolving}>dismiss</button>
        </div>
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
  .sidebar { border-right: 1px solid var(--border); background: white; overflow-y: auto; padding: 0; display: flex; flex-direction: column; }
  .mobile-back { display: none; margin-bottom: 12px; }
  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
  }
  .tab {
    flex: 1;
    background: none;
    border: 0;
    padding: 10px 8px;
    font: inherit;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: 13px;
  }
  .tab:hover { background: var(--hover); }
  .tab.active { color: var(--fg); border-bottom-color: var(--accent); }
  .count {
    font-size: 11px;
    color: var(--muted);
    background: var(--hover);
    border-radius: 999px;
    padding: 1px 6px;
    margin-left: 4px;
  }
  .header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; }
  .link { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; }
  .list { list-style: none; padding: 0 8px 8px; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .list button, .processed-row {
    width: 100%;
    text-align: left;
    background: white;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 10px;
    display: block;
    color: inherit;
    text-decoration: none;
  }
  .list button:hover, .processed-row:hover { background: var(--hover); }
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
  .actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 12px; align-items: center; }
  .resolve-block { margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); }
  .row { display: flex; gap: 8px; margin-bottom: 8px; }
  .row input { flex: 1; }
  .error {
    color: #7a1e1e;
    background: #fff4f4;
    border: 1px solid #f0c0c0;
    border-radius: 6px;
    padding: 8px;
    margin-top: 8px;
    font-size: 13px;
  }

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    /* Show one pane at a time, driven by data-pane on the layout root. */
    .layout[data-pane='list'] .content { display: none; }
    .layout[data-pane='detail'] .sidebar { display: none; }
    .sidebar { border-right: 0; }
    .content { padding: 16px; }
    .mobile-back { display: inline-flex; }
    .desktop-only { display: none; }
    .grid { grid-template-columns: 1fr; gap: 8px; }
    /* Tabs stay visible with their counts; just give them more vertical
       breathing room and let the count chip stay on the same line. */
    .tab { padding: 12px 4px; font-size: 13px; }
    .count { font-size: 10px; padding: 1px 5px; }
    /* Touch-friendly list rows. */
    .list button, .processed-row { padding: 12px; }
    .list { padding: 0 8px 8px; }
  }
</style>
