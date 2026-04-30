<script lang="ts">
  import { api } from '$lib/api';
  import type { ConfirmationItem } from '$lib/types';
  import Icon from '$components/Icon.svelte';
  import NoteContent from '$components/NoteContent.svelte';

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
  interface SkippedItem {
    note_id: string;
    disposition: string;
    note_title: string | null;
    note_created_at: string | null;
    reason: string | null;
    updated_at: string;
  }

  // Tabs follow the lifecycle of a note:
  //   review  → needs your decision (was "Needs review")
  //   skipped → auto-filtered (solo / group)
  //   processed → resolved into a person
  //   dismissed → you said no
  type Tab = 'review' | 'skipped' | 'processed' | 'dismissed';

  const TABS: Array<{
    key: Tab;
    label: string;
    icon: 'list-todo' | 'x' | 'check' | 'trash';
  }> = [
    { key: 'review', label: 'Review', icon: 'list-todo' },
    { key: 'skipped', label: 'Skipped', icon: 'x' },
    { key: 'processed', label: 'Processed', icon: 'check' },
    { key: 'dismissed', label: 'Dismissed', icon: 'trash' },
  ];

  let tab = $state<Tab>('review');
  let pending = $state<ConfirmationItem[]>([]);
  let dismissed = $state<ConfirmationItem[]>([]);
  let processed = $state<ProcessedItem[]>([]);
  let skipped = $state<SkippedItem[]>([]);
  let counts = $state<{ review: number | string; processed: number | string; dismissed: number | string; skipped: number | string }>({
    review: '—',
    processed: '—',
    dismissed: '—',
    skipped: '—',
  });
  let loading = $state(true);

  // Unified selection — a view-model independent of which tab spawned it.
  type Tone = 'review' | 'skipped' | 'processed' | 'dismissed';
  interface NoteVM {
    key: string;                                  // unique row id for the list active state
    noteId: string | null;
    title: string;
    ownerName?: string | null;
    createdAt?: string | null;
    webUrl?: string | null;
    statusLabel: string;
    tone: Tone;
    // Review-only context:
    queueItem?: ConfirmationItem;
    // Processed:
    personId?: string | null;
    personName?: string | null;
    classification?: string | null;
    // Skipped:
    skipReason?: string | null;
    // Optional cached body:
    summary?: string | null;
    transcript?: string | null;
  }
  let selected = $state<NoteVM | null>(null);

  let counterpartName = $state('');
  let counterpartEmail = $state('');
  let resolveError = $state<string | null>(null);
  let resolving = $state(false);

  async function loadAll() {
    const [p, d, pr, sk] = await Promise.all([
      api.get<{ items: ConfirmationItem[] }>('/api/queue?status=pending'),
      api.get<{ items: ConfirmationItem[] }>('/api/queue?status=dismissed'),
      api.get<{ items: ProcessedItem[] }>('/api/queue/processed?limit=200'),
      api.get<{ items: SkippedItem[] }>('/api/queue/skipped?limit=200'),
    ]);
    const byMeetingDateDesc = (a: ConfirmationItem, b: ConfirmationItem) =>
      meetingDateOf(b).localeCompare(meetingDateOf(a));
    pending = [...p.items].sort(byMeetingDateDesc);
    dismissed = [...d.items].sort(byMeetingDateDesc);
    processed = pr.items;
    skipped = sk.items;
    counts = {
      review: p.items.length,
      processed: pr.items.length,
      dismissed: d.items.length,
      skipped: sk.items.length,
    };
    if (selected) {
      // Try to keep the same row selected after a refresh.
      const list = currentVMs();
      selected = list.find((v) => v.key === selected!.key) ?? list[0] ?? null;
    } else {
      const list = currentVMs();
      selected = list[0] ?? null;
    }
  }

  async function load() {
    loading = true;
    try { await loadAll(); } finally { loading = false; }
  }
  $effect(() => { load(); });

  $effect(() => {
    void tab;
    counterpartName = '';
    counterpartEmail = '';
    resolveError = null;
    selected = currentVMs()[0] ?? null;
  });

  function currentVMs(): NoteVM[] {
    if (tab === 'review') return pending.map(toVMQueue);
    if (tab === 'dismissed') return dismissed.map(toVMQueue);
    if (tab === 'processed') return processed.map(toVMProcessed);
    return skipped.map(toVMSkipped);
  }

  function toVMQueue(item: ConfirmationItem): NoteVM {
    const p = item.payload as MeetingClassificationPayload | PersonResolutionPayload;
    const note = p.note;
    const status = item.status as 'pending' | 'dismissed' | 'resolved';
    const tone: Tone = status === 'pending' ? 'review' : status === 'resolved' ? 'processed' : 'dismissed';
    return {
      key: item.id,
      noteId: note?.id ?? null,
      title: note?.title?.trim() || item.kind.replace(/_/g, ' '),
      ownerName: note?.owner?.name ?? null,
      createdAt: note?.created_at ?? item.created_at,
      webUrl: note?.web_url ?? null,
      statusLabel: tone === 'review' ? 'Needs your review' : tone === 'dismissed' ? 'Dismissed' : 'Resolved',
      tone,
      queueItem: item,
      personId: p.resolved_person_id ?? null,
      summary: note?.summary ?? null,
      transcript: note?.transcript_preview ?? null,
    };
  }
  function toVMProcessed(p: ProcessedItem): NoteVM {
    return {
      key: `m:${p.meeting_id}`,
      noteId: p.note_id ?? null,
      title: p.display_name ?? p.event_title ?? '(unnamed)',
      createdAt: p.recorded_at,
      statusLabel: 'Processed',
      tone: 'processed',
      personId: p.person_id ?? null,
      personName: p.display_name ?? null,
      classification: p.classification,
      summary: p.summary,
    };
  }
  function toVMSkipped(s: SkippedItem): NoteVM {
    const reasonPretty = s.disposition.replace(/_/g, ' ');
    return {
      key: `s:${s.note_id}`,
      noteId: s.note_id,
      title: s.note_title ?? '(untitled)',
      createdAt: s.note_created_at ?? s.updated_at,
      statusLabel: `Skipped — ${reasonPretty}`,
      tone: 'skipped',
      skipReason: s.reason ?? reasonPretty,
    };
  }

  async function resolve(decision: 'resolve' | 'dismiss', extra: Record<string, unknown> = {}) {
    if (!selected || !selected.queueItem) return;
    resolving = true;
    resolveError = null;
    try {
      await api.post(`/api/queue/${selected.queueItem.id}/resolve`, { decision, ...extra });
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

  function meetingDateOf(item: ConfirmationItem): string {
    const p = item.payload as { note?: { created_at?: string } } | undefined;
    return p?.note?.created_at ?? item.created_at;
  }
  function fmtDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function fmtDateTime(iso: string): string {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  }

  // Convenience accessors derived from `selected`.
  const isReviewAction = $derived(
    selected?.tone === 'review' &&
    !!selected?.queueItem &&
    (selected.queueItem.kind === 'meeting_classification' ||
     selected.queueItem.kind === 'person_resolution'),
  );
</script>

<div class="layout" data-pane={selected ? 'detail' : 'list'}>
  <aside class="sidebar">
    <div class="tabs" role="tablist" aria-label="Notes lifecycle">
      {#each TABS as t}
        <button
          class="tab"
          class:active={tab === t.key}
          role="tab"
          aria-selected={tab === t.key}
          aria-controls="notes-list"
          onclick={() => (tab = t.key)}
          title={t.label}
        >
          <Icon name={t.icon} size={14} />
          <span class="tab-label">{t.label}</span>
          <span class="count">{counts[t.key]}</span>
        </button>
      {/each}
    </div>

    {#if loading}
      <div class="muted small" style="padding: 8px">loading…</div>
    {:else}
      {@const vms = currentVMs()}
      {#if tab === 'review' && vms.length > 0}
        <div class="header">
          <span class="muted small">{vms.length} pending</span>
          <button class="link small" onclick={clearAll}>clear all</button>
        </div>
      {/if}
      {#if vms.length === 0}
        <div class="muted small" style="padding: 8px">
          {#if tab === 'review'}queue is empty{:else if tab === 'skipped'}no skipped notes{:else if tab === 'processed'}no notes processed yet{:else}none dismissed{/if}
        </div>
      {:else}
        <ul class="list" id="notes-list">
          {#each vms as v (v.key)}
            <li>
              <button
                class:active={selected?.key === v.key}
                onclick={() => (selected = v)}
              >
                <div class="title">{v.title}</div>
                <div class="muted small row-meta">
                  <span class="dot dot-{v.tone}" aria-hidden="true"></span>
                  <span class="kind">{
                    v.tone === 'review'
                      ? (v.queueItem?.kind ?? 'review').replace(/_/g, ' ')
                      : v.tone === 'processed'
                      ? (v.classification ?? 'processed')
                      : v.tone === 'skipped'
                      ? (v.skipReason ?? 'skipped')
                      : 'dismissed'
                  }</span>
                  {#if v.createdAt}<span> · {fmtDate(v.createdAt)}</span>{/if}
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

      <header class="head">
        <div class="head-top">
          <h2>{selected.title}</h2>
          <span class="status-pill tone-{selected.tone}">{selected.statusLabel}</span>
        </div>
        <div class="meta muted small">
          {#if selected.ownerName}{selected.ownerName} · {/if}
          {#if selected.createdAt}{fmtDateTime(selected.createdAt)}{/if}
          {#if selected.webUrl}
            · <a href={selected.webUrl} target="_blank" rel="noopener">open in Granola ↗</a>
          {/if}
        </div>
      </header>

      {#if isReviewAction && selected.queueItem?.kind === 'meeting_classification'}
        {@const p = selected.queueItem.payload as MeetingClassificationPayload}
        <div class="resolve-block">
          <div class="label">Resolve as 1:1</div>
          <p class="muted small">
            Calendar didn't surface a counterpart, so we need who this was with.
            We'll either find an existing person or create one.
          </p>
          <div class="row">
            <input placeholder="Counterpart name (e.g. Aaron Hamlin)" bind:value={counterpartName} disabled={resolving} />
            <input placeholder="email (optional)" bind:value={counterpartEmail} disabled={resolving} />
          </div>
          {#if resolveError}<div class="error">{resolveError}</div>{/if}
          <div class="actions">
            <button
              class="btn btn-primary"
              onclick={resolveOneOnOne}
              disabled={resolving || (!counterpartName.trim() && !counterpartEmail.trim())}
            >{resolving ? 'creating…' : 'create 1:1'}</button>
            <button class="btn" onclick={() => resolve('resolve', { classification: 'group' })} disabled={resolving}>group (skip)</button>
            <button class="btn" onclick={() => resolve('dismiss')} disabled={resolving}>dismiss</button>
          </div>
          {#if p.classifier_reason}
            <p class="muted small reason">Why ambiguous: {p.classifier_reason}</p>
          {/if}
        </div>
      {:else if isReviewAction && selected.queueItem?.kind === 'person_resolution'}
        {@const p = selected.queueItem.payload as PersonResolutionPayload}
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
          {#if resolveError}<div class="error">{resolveError}</div>{/if}
          <div class="actions">
            <button
              class="btn btn-primary"
              disabled={resolving || (!counterpartName.trim() && !counterpartEmail.trim())}
              onclick={() => resolve('resolve', { new_person: { name: counterpartName.trim() || undefined, email: counterpartEmail.trim() || undefined } })}
            >{resolving ? 'creating…' : 'create + ingest'}</button>
            <button class="btn" onclick={() => resolve('dismiss')} disabled={resolving}>dismiss</button>
          </div>
        </div>
      {:else if selected.tone === 'processed' && selected.personId}
        <div class="info-block info-processed">
          <Icon name="check" size={14} />
          Resolved to <a class="strong-link" href={`/people/${selected.personId}`}>{selected.personName ?? 'person'}</a>
        </div>
      {:else if selected.tone === 'skipped'}
        <div class="info-block info-skipped">
          <Icon name="x" size={14} />
          {selected.statusLabel}{#if selected.skipReason && selected.skipReason !== selected.statusLabel.replace(/^Skipped — /, '')} — {selected.skipReason}{/if}
        </div>
      {:else if selected.tone === 'dismissed'}
        <div class="info-block info-dismissed">
          <Icon name="trash" size={14} />
          You dismissed this. The note stays in Granola; it just isn't represented in your people graph.
        </div>
      {/if}

      <NoteContent
        summary={selected.summary}
        transcript={selected.transcript}
        noteId={selected.noteId}
      />
    {:else}
      <div class="muted desktop-only">Pick a note.</div>
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
    overflow-y: auto;
    padding: 0;
    display: flex;
    flex-direction: column;
  }
  .mobile-back { display: none; margin-bottom: 12px; }

  .tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border-bottom: 1px solid var(--border);
  }
  .tab {
    background: none;
    border: 0;
    padding: 10px 4px;
    font: inherit;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: 12px;
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    line-height: 1.2;
  }
  .tab:hover { background: var(--hover); color: var(--fg); }
  .tab.active { color: var(--fg); border-bottom-color: var(--accent); }
  .tab-label { font-weight: 500; }
  .count {
    font-size: 10px;
    color: var(--muted);
    background: var(--hover);
    border-radius: 999px;
    padding: 1px 6px;
    font-variant-numeric: tabular-nums;
  }
  .tab.active .count { background: rgba(67, 56, 202, 0.10); color: var(--accent); }

  .header { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; }
  .link { background: none; border: none; color: var(--accent); cursor: pointer; padding: 0; text-decoration: underline; font-size: 12px; }

  .list { list-style: none; padding: 0 8px 8px; margin: 0; display: flex; flex-direction: column; gap: 2px; }
  .list button {
    width: 100%;
    text-align: left;
    background: white;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 10px;
    display: block;
    color: inherit;
    cursor: pointer;
    font: inherit;
  }
  .list button:hover { background: var(--hover); }
  .list button.active { background: var(--hover); border-color: var(--border); }
  .title { font-weight: 500; line-height: 1.3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-meta { display: inline-flex; align-items: center; gap: 4px; }
  .kind { text-transform: capitalize; }

  /* Tone-coloured dot in the list row, matches status pill in the detail. */
  .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; }
  .dot-review    { background: var(--accent); }
  .dot-skipped   { background: #94a3b8; }
  .dot-processed { background: #16a34a; }
  .dot-dismissed { background: #b91c1c; }

  .content { padding: 24px 32px; overflow-y: auto; display: flex; flex-direction: column; gap: 16px; }

  .head { display: flex; flex-direction: column; gap: 6px; }
  .head-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
  .head h2 { margin: 0; font-size: 22px; line-height: 1.25; }
  .meta { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }

  .status-pill {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-weight: 600;
    padding: 3px 10px;
    border-radius: 999px;
    background: var(--hover);
    color: var(--muted);
    flex-shrink: 0;
    white-space: nowrap;
  }
  .tone-review    { background: rgba(67, 56, 202, 0.10); color: var(--accent); }
  .tone-skipped   { background: rgba(148, 163, 184, 0.18); color: #475569; }
  .tone-processed { background: rgba(22, 163, 74, 0.10); color: #15803d; }
  .tone-dismissed { background: rgba(185, 28, 28, 0.08); color: #991b1b; }

  .info-block {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    border-radius: 10px;
    border: 1px solid var(--border);
    background: white;
    font-size: 13px;
    width: fit-content;
  }
  .info-processed { border-color: rgba(22, 163, 74, 0.25); background: rgba(22, 163, 74, 0.05); color: #15803d; }
  .info-skipped   { border-color: rgba(148, 163, 184, 0.35); background: rgba(148, 163, 184, 0.08); color: #475569; }
  .info-dismissed { border-color: rgba(185, 28, 28, 0.20); background: rgba(185, 28, 28, 0.04); color: #991b1b; }
  .strong-link { font-weight: 600; }

  .resolve-block {
    border: 1px solid var(--border);
    background: white;
    border-radius: 10px;
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .label { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .row { display: flex; gap: 8px; }
  .row input { flex: 1; }
  .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .reason { margin: 4px 0 0; }
  .error {
    color: #7a1e1e;
    background: #fff4f4;
    border: 1px solid #f0c0c0;
    border-radius: 6px;
    padding: 8px;
    font-size: 13px;
  }

  @media (max-width: 720px) {
    .layout { grid-template-columns: 1fr; }
    .layout[data-pane='list'] .content { display: none; }
    .layout[data-pane='detail'] .sidebar { display: none; }
    .sidebar { border-right: 0; }
    .content { padding: 16px; }
    .mobile-back { display: inline-flex; }
    .desktop-only { display: none; }
    .head h2 { font-size: 18px; }
    .head-top { flex-direction: column; gap: 8px; }
    .tab { padding: 10px 2px; }
    .tab-label { font-size: 11px; }
    .row { flex-direction: column; }
    .list button { padding: 12px; }
    .list { padding: 0 8px 8px; }
  }
</style>
