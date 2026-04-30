<script lang="ts">
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import type { PersonView, TagRow, ChatThread } from '$lib/types';
  import { ulid } from '$lib/ulid';
  import ChatPane from './ChatPane.svelte';
  import Icon from './Icon.svelte';
  import MergeModal from './MergeModal.svelte';
  import PersonAvatar from './PersonAvatar.svelte';
  import ContactRow from './ContactRow.svelte';
  import EditableField from './EditableField.svelte';
  import { fmtShortDate, fmtShortDateTime } from '$lib/dates';

  interface Props {
    view: PersonView;
    allTags: TagRow[];
    onChanged: () => void | Promise<void>;
  }
  let { view, allTags, onChanged }: Props = $props();

  let editing = $state<'context' | 'needs' | 'offers' | null>(null);
  let editValue = $state('');
  let newTagName = $state('');
  let mergeOpen = $state(false);

  async function onMerged() {
    mergeOpen = false;
    await onChanged();
  }

  let chatThreadId = $state<string | null>(null);
  let lastLoadedPersonId = $state<string | null>(null);

  $effect(() => {
    const pid = view.person.id;
    if (pid === lastLoadedPersonId) return;
    lastLoadedPersonId = pid;
    chatThreadId = null;
    void resumeOrCreateThread(pid);
  });

  async function resumeOrCreateThread(personId: string) {
    try {
      const { threads } = await api.get<{ threads: ChatThread[] }>(
        `/api/chat/threads?scope=person&person_id=${encodeURIComponent(personId)}`,
      );
      chatThreadId = threads[0]?.id ?? ulid();
    } catch {
      chatThreadId = ulid();
    }
  }

  async function startEdit(field: 'context' | 'needs' | 'offers') {
    editing = field;
    editValue = view.person[field] ?? '';
  }

  async function saveEdit() {
    if (!editing) return;
    const patch: Record<string, unknown> = {};
    if (editing === 'context') {
      patch.context_replacement = editValue;
      patch.context_manual_override = true;
    } else if (editing === 'needs') {
      patch.needs_replacement = editValue;
    } else if (editing === 'offers') {
      patch.offers_replacement = editValue;
    }
    await api.patch(`/api/people/${view.person.id}`, patch);
    editing = null;
    await onChanged();
  }

  async function addTag() {
    const name = newTagName.trim().toLowerCase();
    if (!name) return;
    await api.post(`/api/people/${view.person.id}/tags`, { tag_name: name });
    newTagName = '';
    await onChanged();
  }

  async function removeTag(name: string) {
    await api.delete(`/api/people/${view.person.id}/tags/${encodeURIComponent(name)}`);
    await onChanged();
  }

  async function removeRole(name: string) {
    const next = view.roles.filter((r) => r !== name);
    await api.patch(`/api/people/${view.person.id}`, { roles_set: next });
    await onChanged();
  }

  async function removeTrajectory(name: string) {
    const next = view.trajectoryTags.filter((t) => t !== name);
    await api.patch(`/api/people/${view.person.id}`, { trajectory_tags_set: next });
    await onChanged();
  }

  async function saveFollowupBody(id: string, next: string) {
    await api.patch(`/api/followups/${id}`, { body: next });
    await onChanged();
  }

  // Group signals under the meeting they came from so the timeline reads
  // as "this happened, here's what we extracted".
  const signalsByMeeting = $derived.by(() => {
    const map = new Map<string, typeof view.recentSignals>();
    const orphans: typeof view.recentSignals = [];
    for (const s of view.recentSignals) {
      if (s.meeting_id) {
        const arr = map.get(s.meeting_id) ?? [];
        arr.push(s);
        map.set(s.meeting_id, arr);
      } else {
        orphans.push(s);
      }
    }
    return { map, orphans };
  });

  async function completeFollowup(id: string) {
    await api.post(`/api/followups/${id}/complete`, { status: 'done' });
    await onChanged();
  }

  async function setFollowupStatus(id: string, status: 'open' | 'done' | 'dropped') {
    await api.post(`/api/followups/${id}/complete`, { status });
    await onChanged();
  }

  let followupTab = $state<'open' | 'done'>('open');

  // Pull a date marker like "[2026-04-30]" off the front of context so we can
  // render it as a chip rather than inline text.
  function splitDateMarker(s: string | null): { date: string | null; rest: string } {
    if (!s) return { date: null, rest: '' };
    const m = s.match(/^\[(\d{4}-\d{2}-\d{2})\]\s*([\s\S]*)$/);
    if (m) return { date: m[1] ?? null, rest: m[2] ?? '' };
    return { date: null, rest: s };
  }
</script>

<div class="profile">
  <!-- ======================================================== HEADER -->
  <header class="hero">
    <PersonAvatar
      personId={view.person.id}
      name={view.person.display_name}
      avatarUrl={view.person.avatar_url}
      size={56}
    />
    <div class="hero-main">
      <div class="hero-top">
        <h1>
          <EditableField
            value={view.person.display_name}
            placeholder="(unnamed)"
            label="Edit name"
            onSave={async (next) => {
              await api.patch(`/api/people/${view.person.id}`, { display_name: next });
              await onChanged();
            }}
          />
        </h1>
        <span class="spacer"></span>
        <button class="btn small ghost" onclick={() => (mergeOpen = true)} title="Merge a duplicate into this person">
          <Icon name="merge" size={14} /> Merge with…
        </button>
      </div>
      <div class="hero-meta muted small">
        <span class="meta-cell">
          <EditableField
            value={view.person.primary_email}
            placeholder="add email"
            label="Edit email"
            type="email"
            onSave={async (next) => {
              await api.patch(`/api/people/${view.person.id}`, { email: next });
              await onChanged();
            }}
          />
        </span>
        <span class="meta-cell">
          <EditableField
            value={view.person.phone}
            placeholder="add phone"
            label="Edit phone"
            type="tel"
            onSave={async (next) => {
              await api.patch(`/api/people/${view.person.id}`, { phone: next });
              await onChanged();
            }}
          />
        </span>
        <span class="meta-cell">
          🏠
          <EditableField
            value={view.person.home_location}
            placeholder="add home"
            label="Edit home location"
            onSave={async (next) => {
              await api.patch(`/api/people/${view.person.id}`, { home_location: next });
              await onChanged();
            }}
          />
        </span>
        <span class="meta-cell">
          💼
          <EditableField
            value={view.person.work_org}
            placeholder="add org"
            label="Edit work org"
            onSave={async (next) => {
              await api.patch(`/api/people/${view.person.id}`, { work_org: next });
              await onChanged();
            }}
          />
          {#if view.person.work_org || view.person.work_location}
            <span class="muted">·</span>
          {/if}
          <EditableField
            value={view.person.work_location}
            placeholder="add work location"
            label="Edit work location"
            onSave={async (next) => {
              await api.patch(`/api/people/${view.person.id}`, { work_location: next });
              await onChanged();
            }}
          />
        </span>
        <span class="meta-cell">last met {fmtShortDate(view.person.last_met_date)}</span>
        <span class="meta-cell">{view.person.meeting_count} meeting{view.person.meeting_count === 1 ? '' : 's'}</span>
      </div>
      <!-- One unified tag row: roles (filled), trajectory (outlined),
           free tags (white), with × removals and an inline add input.
           Replaces the old separate "Tags" card. -->
      <div class="tagrow">
        {#each view.roles as r}
          <span class="chip role">
            {r}
            <button class="chip-x" onclick={() => removeRole(r)} aria-label="remove role {r}">×</button>
          </span>
        {/each}
        {#each view.trajectoryTags as t}
          <span class="chip trajectory">
            {t}
            <button class="chip-x" onclick={() => removeTrajectory(t)} aria-label="remove trajectory {t}">×</button>
          </span>
        {/each}
        {#each view.tags as t}
          <span class="chip tag">
            {t}
            <button class="chip-x" onclick={() => removeTag(t)} aria-label="remove tag {t}">×</button>
          </span>
        {/each}
        <input
          class="tag-input"
          list="tag-options"
          bind:value={newTagName}
          placeholder="add tag…"
          onkeydown={(e) => e.key === 'Enter' && addTag()}
        />
        <datalist id="tag-options">
          {#each allTags as t}<option value={t.name}></option>{/each}
        </datalist>
      </div>
      <div class="contact-slot">
        <ContactRow email={view.person.primary_email} phone={view.person.phone} />
      </div>
    </div>
  </header>

  <!-- ======================================================== CONTEXT -->
  <section class="card context-card">
    <header class="card-hd">
      <h3>
        <span class="hd-dot context-dot"></span>
        Context
        {#if view.person.context_manual_override}<span class="badge">manual</span>{/if}
      </h3>
      {#if editing !== 'context'}
        <button class="btn small ghost" onclick={() => startEdit('context')}>
          edit
        </button>
      {/if}
    </header>
    {#if editing === 'context'}
      <textarea bind:value={editValue} rows="6"></textarea>
      <div class="row">
        <button class="btn btn-primary" onclick={saveEdit}>Save</button>
        <button class="btn ghost" onclick={() => (editing = null)}>Cancel</button>
      </div>
    {:else}
      {@const ctx = splitDateMarker(view.person.context)}
      {#if ctx.rest || ctx.date}
        <div class="prose context-body">
          {#if ctx.date}<span class="datepill">{ctx.date}</span>{/if}<span class="ctx-text">{ctx.rest || '—'}</span>
        </div>
      {:else}
        <div class="empty">
          <p class="muted">No context yet — drop a meeting transcript or use the chat below.</p>
        </div>
      {/if}
    {/if}
  </section>

  <!-- ======================================================== NEEDS / OFFERS -->
  <div class="grid2">
    <section class="card need-card">
      <header class="card-hd">
        <h3><span class="hd-dot need-dot"></span>Needs</h3>
        {#if editing !== 'needs'}
          <button class="btn small ghost" onclick={() => startEdit('needs')}>edit</button>
        {/if}
      </header>
      {#if editing === 'needs'}
        <textarea bind:value={editValue} rows="4"></textarea>
        <div class="row">
          <button class="btn btn-primary" onclick={saveEdit}>Save</button>
          <button class="btn ghost" onclick={() => (editing = null)}>Cancel</button>
        </div>
      {:else if view.person.needs}
        <p class="prose">{view.person.needs}</p>
      {:else}
        <p class="muted small empty-line">Nothing captured yet.</p>
      {/if}
    </section>
    <section class="card offer-card">
      <header class="card-hd">
        <h3><span class="hd-dot offer-dot"></span>Offers</h3>
        {#if editing !== 'offers'}
          <button class="btn small ghost" onclick={() => startEdit('offers')}>edit</button>
        {/if}
      </header>
      {#if editing === 'offers'}
        <textarea bind:value={editValue} rows="4"></textarea>
        <div class="row">
          <button class="btn btn-primary" onclick={saveEdit}>Save</button>
          <button class="btn ghost" onclick={() => (editing = null)}>Cancel</button>
        </div>
      {:else if view.person.offers}
        <p class="prose">{view.person.offers}</p>
      {:else}
        <p class="muted small empty-line">Nothing captured yet.</p>
      {/if}
    </section>
  </div>

  <!-- ======================================================== RECENT MEETINGS -->
  <section class="card">
    <header class="card-hd">
      <h3><span class="hd-dot meeting-dot"></span>Recent meetings</h3>
    </header>
    {#if view.recentMeetings.length === 0}
      <p class="muted small empty-line">No meetings recorded yet.</p>
    {:else}
      <ol class="timeline">
        {#each view.recentMeetings as m}
          <li class="timeline-row">
            <div class="timeline-rail">
              <span class="datepill">{fmtShortDate(m.recorded_at)}</span>
            </div>
            <div class="timeline-body">
              <div class="meeting-meta muted small">
                <span class="chip-mini">{m.classification}</span>
                <span>· {m.source}</span>
              </div>
              <div class="meeting-summary">{m.summary ?? 'No summary captured.'}</div>
            </div>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <!-- ======================================================== SIGNALS -->
  <section class="card">
    <header class="card-hd">
      <h3><span class="hd-dot signal-dot"></span>Signals</h3>
    </header>
    {#if view.recentSignals.length === 0}
      <p class="muted small empty-line">Nothing extracted yet.</p>
    {:else}
      <ul class="signals">
        {#each view.recentSignals as s}
          <li class="signal-row">
            <span class="kind k-{s.kind}">{s.kind.replace('_', ' ')}</span>
            <span class="signal-body">{s.body}</span>
            {#if s.confidence != null}
              <span class="confidence" title="confidence">
                <span class="conf-bar"><span class="conf-fill" style="width: {Math.round((s.confidence ?? 0) * 100)}%"></span></span>
                <span class="conf-num">{(s.confidence * 100).toFixed(0)}%</span>
              </span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <!-- ======================================================== FOLLOWUPS -->
  <section class="card">
    <header class="card-hd">
      <h3><span class="hd-dot followup-dot"></span>Followups</h3>
      <span class="spacer"></span>
      <div class="followup-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={followupTab === 'open'}
          class:active={followupTab === 'open'}
          onclick={() => (followupTab = 'open')}
        >Open <span class="count">{view.openFollowups.length}</span></button>
        <button
          role="tab"
          aria-selected={followupTab === 'done'}
          class:active={followupTab === 'done'}
          onclick={() => (followupTab = 'done')}
        >Completed <span class="count">{view.closedFollowups.length}</span></button>
      </div>
    </header>

    {#if followupTab === 'open'}
      {#if view.openFollowups.length === 0}
        <p class="muted small empty-line">Nothing pending.</p>
      {:else}
        <ul class="followups">
          {#each view.openFollowups as f (f.id)}
            <li class="followup-row">
              <input
                type="checkbox"
                aria-label="mark done"
                onchange={() => setFollowupStatus(f.id, 'done')}
              />
              <span class="followup-body">
                <EditableField
                  value={f.body}
                  multiline
                  placeholder="(empty)"
                  label="Edit followup"
                  onSave={(next) => saveFollowupBody(f.id, next)}
                />
              </span>
              {#if f.due_date}<span class="datepill due">due {fmtShortDate(f.due_date)}</span>{/if}
            </li>
          {/each}
        </ul>
      {/if}
    {:else}
      {#if view.closedFollowups.length === 0}
        <p class="muted small empty-line">No completed followups yet.</p>
      {:else}
        <ul class="followups">
          {#each view.closedFollowups as f (f.id)}
            <li class="followup-row done">
              <input
                type="checkbox"
                checked
                aria-label="re-open"
                onchange={() => setFollowupStatus(f.id, 'open')}
              />
              <span class="followup-body strike">
                <EditableField
                  value={f.body}
                  multiline
                  placeholder="(empty)"
                  label="Edit followup"
                  onSave={(next) => saveFollowupBody(f.id, next)}
                />
              </span>
              {#if f.completed_at}
                <span class="datepill done-date">{f.status} {fmtShortDate(f.completed_at)}</span>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <!-- ======================================================== CHAT -->
  <section class="card chat-card">
    <header class="card-hd">
      <h3><span class="hd-dot chat-dot"></span>Per-person chat</h3>
      <button class="btn small ghost" onclick={() => (chatThreadId = ulid())}>
        <Icon name="plus" size={12} /> new
      </button>
    </header>
    <div class="chatbox">
      {#if chatThreadId}
        <ChatPane
          scope="person"
          personId={view.person.id}
          threadId={chatThreadId}
          onWrite={() => onChanged()}
        />
      {:else}
        <div class="muted" style="padding: 12px">Loading chat…</div>
      {/if}
    </div>
  </section>
</div>

{#if mergeOpen}
  <MergeModal
    keepPerson={{
      person_id: view.person.id,
      display_name: view.person.display_name,
      primary_email: view.person.primary_email,
      last_met_date: view.person.last_met_date,
      meeting_count: view.person.meeting_count,
      aliases: view.aliases,
      roles: view.roles,
      context: view.person.context,
      needs: view.person.needs,
      offers: view.person.offers,
    }}
    onClose={() => (mergeOpen = false)}
    onMerged={() => onMerged()}
  />
{/if}

<style>
  /* ──────────────────────────────────────────── layout */
  .profile {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 920px;
  }

  /* ──────────────────────────────────────────── hero */
  .hero {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: linear-gradient(180deg, white 0%, var(--bg) 100%);
  }
  .hero-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 8px; }
  .hero-top { display: flex; align-items: center; gap: 8px; }
  .hero-top h1 {
    margin: 0;
    font-size: 22px;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    row-gap: 4px;
    align-items: center;
  }
  .meta-cell {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .role-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: 2px;
  }
  .contact-slot { margin-top: 4px; }

  /* ──────────────────────────────────────────── card primitive */
  .card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .card-hd {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .card-hd h3 {
    margin: 0;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .card-hd > .btn { margin-left: auto; }

  /* Section accent dots — small colored circle next to the heading.
     Keeps the palette minimal but each section gets a quiet identity. */
  .hd-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
    background: var(--muted);
  }
  .tag-dot      { background: #94a3b8; } /* slate */
  .context-dot  { background: var(--accent); }
  .need-dot     { background: #2563eb; } /* blue */
  .offer-dot    { background: #16a34a; } /* green */
  .meeting-dot  { background: #7c3aed; } /* violet */
  .signal-dot   { background: #ea580c; } /* orange */
  .followup-dot { background: #d97706; } /* amber */
  .chat-dot     { background: var(--fg); }

  /* Two-column section grid for needs/offers. */
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }

  /* ──────────────────────────────────────────── tags */
  .tagrow {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
  }
  .chip-x {
    background: none;
    border: 0;
    color: inherit;
    padding: 0 0 0 4px;
    opacity: 0.5;
    line-height: 1;
    font-size: 14px;
  }
  .chip-x:hover { opacity: 1; }

  /* Distinguish chip variants — same shape, different fills. */
  .chip.role {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .chip.trajectory {
    background: rgba(67, 56, 202, 0.08);
    color: var(--accent);
    border-color: rgba(67, 56, 202, 0.2);
  }
  .chip.tag {
    background: white;
    border-color: var(--border);
  }
  .tag-input {
    flex: 0 1 200px;
    min-width: 140px;
    border: 1px dashed var(--border);
    background: transparent;
    padding: 4px 8px;
    border-radius: 999px;
    font-size: 12px;
  }

  /* ──────────────────────────────────────────── context */
  .context-body { line-height: 1.6; }
  .ctx-text { white-space: pre-wrap; }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    background: rgba(217, 119, 6, 0.1);
    color: #b45309;
    padding: 1px 6px;
    border-radius: 999px;
    font-weight: 600;
  }

  /* ──────────────────────────────────────────── needs / offers */
  .need-card { border-left: 3px solid #2563eb; }
  .offer-card { border-left: 3px solid #16a34a; }
  .empty-line { margin: 0; }

  /* ──────────────────────────────────────────── timeline */
  .timeline {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .timeline-row {
    display: grid;
    grid-template-columns: 96px 1fr;
    gap: 12px;
    align-items: start;
  }
  .timeline-rail {
    display: flex;
    justify-content: flex-end;
  }
  .timeline-body { min-width: 0; }
  .meeting-meta { display: flex; gap: 6px; align-items: center; margin-bottom: 4px; }
  .meeting-summary { line-height: 1.5; color: var(--fg); }

  /* ──────────────────────────────────────────── signals */
  .signals { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px; }
  .signal-row {
    display: grid;
    grid-template-columns: 96px 1fr 96px;
    gap: 12px;
    align-items: center;
    padding: 6px 0;
    border-bottom: 1px solid var(--hover);
  }
  .signal-row:last-child { border-bottom: 0; }
  .kind {
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    text-align: center;
    padding: 3px 8px;
    border-radius: 999px;
    background: var(--hover);
    color: var(--muted);
  }
  .k-need          { background: rgba(37, 99, 235, 0.10); color: #1d4ed8; }
  .k-offer         { background: rgba(22, 163, 74, 0.10); color: #15803d; }
  .k-status_change { background: rgba(217, 119, 6, 0.10); color: #b45309; }
  .k-commitment    { background: rgba(124, 58, 237, 0.10); color: #6d28d9; }
  .k-note          { background: var(--hover); color: var(--muted); }
  .signal-body { line-height: 1.5; }
  .confidence {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }
  .conf-bar {
    width: 48px;
    height: 4px;
    background: var(--hover);
    border-radius: 999px;
    overflow: hidden;
  }
  .conf-fill {
    display: block;
    height: 100%;
    background: linear-gradient(90deg, #94a3b8 0%, var(--accent) 100%);
    border-radius: 999px;
  }

  /* ──────────────────────────────────────────── followups */
  .followups { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .followup-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 8px 12px;
    background: var(--hover);
    border-radius: 8px;
  }
  .followup-label {
    flex: 1;
    display: flex;
    align-items: flex-start;
    gap: 8px;
    cursor: pointer;
  }
  .followup-label input { margin-top: 3px; }
  .followup-body { flex: 1; line-height: 1.45; }
  .due { background: rgba(217, 119, 6, 0.1); color: #b45309; border-color: rgba(217, 119, 6, 0.25); }
  .done-date { background: rgba(22, 163, 74, 0.10); color: #15803d; border-color: rgba(22, 163, 74, 0.25); text-transform: capitalize; }
  .followup-row.done { background: rgba(22, 163, 74, 0.04); }
  .strike { text-decoration: line-through; color: var(--muted); }
  .followup-tabs {
    display: inline-flex;
    background: var(--hover);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px;
  }
  .followup-tabs button {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .followup-tabs button.active { background: white; color: var(--fg); box-shadow: 0 1px 1px rgba(0,0,0,0.04); }
  .followup-tabs .count {
    font-size: 10px;
    background: rgba(0,0,0,0.05);
    padding: 1px 6px;
    border-radius: 999px;
    color: var(--muted);
  }
  .followup-tabs button.active .count { background: rgba(67, 56, 202, 0.10); color: var(--accent); }

  /* ──────────────────────────────────────────── shared bits */
  .datepill {
    display: inline-block;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
    background: var(--hover);
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    white-space: nowrap;
    margin-right: 8px;
    flex-shrink: 0;
  }
  .chip-mini {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    background: rgba(67, 56, 202, 0.08);
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 999px;
    font-weight: 600;
  }
  .prose { white-space: pre-wrap; margin: 0; line-height: 1.55; color: var(--fg); }
  textarea { width: 100%; resize: vertical; min-height: 96px; }
  .row { display: flex; gap: 8px; }
  .btn.ghost {
    background: transparent;
    border-color: transparent;
    color: var(--muted);
  }
  .btn.ghost:hover { background: var(--hover); color: var(--fg); border-color: var(--border); }
  .empty {
    padding: 8px 0;
  }

  /* ──────────────────────────────────────────── chat */
  .chat-card { padding-bottom: 0; }
  .chatbox {
    height: 360px;
    border-top: 1px solid var(--border);
    margin: 0 -16px -16px;
    overflow: hidden;
  }
  /* Round only the bottom corners since the chatbox is flush with the card edge. */
  .chat-card .chatbox {
    border-bottom-left-radius: 12px;
    border-bottom-right-radius: 12px;
  }

  /* ──────────────────────────────────────────── responsive */
  @media (max-width: 720px) {
    .grid2 { grid-template-columns: 1fr; }
    .chatbox { height: 320px; }
    .hero { padding: 16px; flex-direction: column; }
    .timeline-row { grid-template-columns: 1fr; }
    .timeline-rail { justify-content: flex-start; }
    .signal-row { grid-template-columns: 86px 1fr; }
    .signal-row .confidence { grid-column: 2; justify-self: start; }
  }
</style>
