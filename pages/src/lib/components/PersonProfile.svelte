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
  import SegmentedToggle from './SegmentedToggle.svelte';
  import { fmtShortDate, fmtShortDateTime } from '$lib/dates';

  interface Props {
    view: PersonView;
    allTags: TagRow[];
    onChanged: () => void | Promise<void>;
  }
  let { view, allTags, onChanged }: Props = $props();

  type ProseField = 'context' | 'needs' | 'offers';
  // Per-field edit state. The header pencil ALSO opens every empty field
  // for editing (see isEditing/visibleCard below), so we track each one
  // independently rather than the previous single-slot model.
  let editingFields = $state<Record<ProseField, boolean>>({
    context: false,
    needs: false,
    offers: false,
  });
  let editValues = $state<Record<ProseField, string>>({
    context: '',
    needs: '',
    offers: '',
  });

  let newTagName = $state('');
  let mergeOpen = $state(false);
  // Edit-mode for the header card. When false, empty cards/fields are
  // hidden so sparse profiles read clean. Toggling on:
  //   - reveals all currently-empty cards (Context, Needs, Offers, Signals,
  //     Recent meetings)
  //   - opens an inline editor on the empty prose fields
  //   - keeps Offers in the right column even when Needs is hidden
  //     (inline grid-column on need-card / offer-card; mobile media query
  //     overrides to single-column)
  let editingHeader = $state(false);
  function hasVal(s: string | null | undefined): boolean {
    return !!(s && s.trim());
  }
  function fieldHasData(f: ProseField): boolean {
    return hasVal(view.person[f]);
  }
  function isEditing(f: ProseField): boolean {
    // Explicit edit click wins; otherwise empty fields auto-edit when the
    // header pencil is on.
    return editingFields[f] || (editingHeader && !fieldHasData(f));
  }
  function visibleCard(f: ProseField): boolean {
    return fieldHasData(f) || editingHeader;
  }
  // When editing kicks in for a field, seed its draft from the saved value.
  $effect(() => {
    for (const f of ['context', 'needs', 'offers'] as ProseField[]) {
      if (isEditing(f) && editValues[f] === '' && fieldHasData(f)) {
        editValues[f] = view.person[f] ?? '';
      }
    }
  });

  // Connection degree: 0 = You (only one row), 1 = direct connection
  // (default), 2 = needs intro / "Distant". Default 1 shows nothing.
  // 0 and 2 surface as a corner ribbon and as a label in editingHeader.
  function degreeLabel(d: number | null | undefined): string | null {
    if (d === 0) return 'You';
    if (d === 2) return 'Distant';
    return null;
  }
  // Server-truth derived value; the SegmentedToggle binds to it via a
  // function binding (read = this derived, write = PATCH and refetch).
  let degreeChoice = $derived<'1' | '2'>(view.person.degree === 2 ? '2' : '1');
  async function commitDegree(next: '1' | '2') {
    const n = Number(next);
    if (n === view.person.degree) return;
    await api.patch(`/api/people/${view.person.id}`, { degree: n });
    await onChanged();
  }

  // Auxiliary actions dropdown (merge / delete). Click-outside via document
  // listener so we don't need a portal.
  let auxOpen = $state(false);
  let auxAnchor: HTMLElement | undefined = $state();
  $effect(() => {
    if (!auxOpen) return;
    function onDoc(e: MouseEvent) {
      if (!auxAnchor) return;
      if (!auxAnchor.contains(e.target as Node)) auxOpen = false;
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  });

  async function deletePerson() {
    auxOpen = false;
    const name = view.person.display_name?.trim() || view.person.primary_email?.trim() || '(unnamed)';
    const confirmation = prompt(
      `Delete "${name}"? This removes the person, their tags, signals, followups, and chat history. Meetings are kept but orphaned. Type the name to confirm:`,
    );
    if (confirmation == null) return;
    if (confirmation.trim() !== name.trim()) {
      alert('Name did not match. Aborted.');
      return;
    }
    await api.delete(`/api/people/${view.person.id}`);
    await goto('/people');
  }

  async function onMerged() {
    mergeOpen = false;
    await onChanged();
  }

  let chatThreadId = $state<string | null>(null);
  let lastLoadedPersonId = $state<string | null>(null);
  // Chat history is collapsed by default — the composer is the focal
  // affordance, the history is one click away. ChatPane manages the
  // toggle button itself; we hold the bound state so the surrounding
  // .chatbox can resize to fit.
  let chatHistoryVisible = $state(false);

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

  function startEdit(f: ProseField) {
    editingFields[f] = true;
    editValues[f] = view.person[f] ?? '';
  }

  async function saveField(f: ProseField) {
    const patch: Record<string, unknown> = {};
    const value = editValues[f];
    if (f === 'context') {
      patch.context_replacement = value;
      patch.context_manual_override = true;
    } else if (f === 'needs') {
      patch.needs_replacement = value;
    } else if (f === 'offers') {
      patch.offers_replacement = value;
    }
    await api.patch(`/api/people/${view.person.id}`, patch);
    editingFields[f] = false;
    editValues[f] = '';
    await onChanged();
  }

  function cancelEdit(f: ProseField) {
    editingFields[f] = false;
    editValues[f] = '';
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

  async function deleteFollowup(id: string) {
    if (!confirm('Delete this followup? It will be removed permanently.')) return;
    await api.delete(`/api/followups/${id}`);
    await onChanged();
  }

  let newFollowupBody = $state('');
  let newFollowupDue = $state('');
  // Hide the "add followup" form until the user explicitly opens it. Reduces
  // visual weight on profiles with no pending followups.
  let addingFollowup = $state(false);
  let creatingFollowup = $state(false);

  async function createFollowup() {
    const body = newFollowupBody.trim();
    if (!body || creatingFollowup) return;
    creatingFollowup = true;
    try {
      await api.post('/api/followups', {
        person_id: view.person.id,
        body,
        due_date: newFollowupDue || undefined,
      });
      newFollowupBody = '';
      newFollowupDue = '';
      addingFollowup = false;
      followupTab = 'open';
      await onChanged();
    } finally {
      creatingFollowup = false;
    }
  }

  // Map signal kinds to friendlier labels. Display only — DB still stores
  // the raw enum values.
  const SIGNAL_KIND_LABELS: Record<string, string> = {
    need: 'Need',
    offer: 'Offer',
    status_change: 'Status',
    commitment: 'Commitment',
    note: 'Note',
  };
  function signalKindLabel(kind: string): string {
    return SIGNAL_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ');
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
    {#if degreeLabel(view.person.degree)}
      <!-- Corner ribbon, clipped to the hero card's top-left corner via a
           mask wrapper with overflow:hidden + matching border-radius. The
           band's two ends visually terminate inside the card so it reads
           as wrapping the corner, not floating off the edge. -->
      <div class="ribbon-mask" aria-hidden="true">
        <div
          class="corner-band"
          class:band-you={view.person.degree === 0}
          class:band-distant={view.person.degree === 2}
        >
          {degreeLabel(view.person.degree)}
        </div>
      </div>
      <span class="sr-only">Connection degree: {degreeLabel(view.person.degree)}</span>
    {/if}
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
        <button
          class="btn small ghost icon-only"
          onclick={() => (editingHeader = !editingHeader)}
          aria-pressed={editingHeader}
          title={editingHeader ? 'Done editing' : 'Edit profile fields'}
        >
          <Icon name={editingHeader ? 'check' : 'pencil'} size={14} />
        </button>
        <div class="aux-wrap" bind:this={auxAnchor}>
          <button
            class="btn small ghost icon-only"
            onclick={() => (auxOpen = !auxOpen)}
            aria-haspopup="menu"
            aria-expanded={auxOpen}
            title="More actions"
          >
            <Icon name="more-horizontal" size={14} />
          </button>
          {#if auxOpen}
            <div class="aux-menu" role="menu">
              <button class="aux-item" role="menuitem" onclick={() => { auxOpen = false; mergeOpen = true; }}>
                <Icon name="merge" size={14} /> Merge with…
              </button>
              <button class="aux-item danger" role="menuitem" onclick={deletePerson}>
                <Icon name="trash" size={14} /> Delete person
              </button>
            </div>
          {/if}
        </div>
      </div>
      <div class="hero-meta muted small">
        {#if editingHeader || hasVal(view.person.primary_email)}
          <span class="meta-cell">
            <Icon name="mail" size={14} />
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
        {/if}
        {#if editingHeader || hasVal(view.person.phone)}
          <span class="meta-cell">
            <Icon name="phone" size={14} />
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
        {/if}
        {#if editingHeader || hasVal(view.person.home_location)}
          <span class="meta-cell">
            <Icon name="home" size={14} />
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
        {/if}
        {#if editingHeader || hasVal(view.person.work_org)}
          <span class="meta-cell">
            <Icon name="briefcase" size={14} />
            <EditableField
              value={view.person.work_org}
              placeholder="add org"
              label="Edit work org"
              onSave={async (next) => {
                await api.patch(`/api/people/${view.person.id}`, { work_org: next });
                await onChanged();
              }}
            />
          </span>
        {/if}
        {#if editingHeader || hasVal(view.person.work_location)}
          <span class="meta-cell">
            <Icon name="map-pin" size={14} />
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
        {/if}
        {#if hasVal(view.person.last_met_date)}
          <span class="meta-cell">
            <Icon name="calendar" size={14} />
            last met {fmtShortDate(view.person.last_met_date)}
          </span>
        {/if}
        {#if view.person.meeting_count > 0}
          <span class="meta-cell">
            <Icon name="users" size={14} />
            {view.person.meeting_count} meeting{view.person.meeting_count === 1 ? '' : 's'}
          </span>
        {/if}
        {#if editingHeader}
          <span class="meta-cell degree-cell">
            <Icon name="users" size={14} />
            <span class="degree-label">Connection</span>
            {#if view.person.degree === 0}
              <span class="chip role">You</span>
              <span class="muted small">(can't be changed — there's only one You)</span>
            {:else}
              <SegmentedToggle
                ariaLabel="Connection degree"
                options={[
                  { value: '1', label: 'Direct' },
                  { value: '2', label: 'Distant' },
                ]}
                bind:selected={
                  () => degreeChoice,
                  (v) => void commitDegree(v)
                }
              />
            {/if}
          </span>
        {/if}
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
  {#if visibleCard('context')}
    <section class="card context-card">
      <header class="card-hd">
        <h3>
          <span class="hd-dot context-dot"></span>
          Context
          {#if view.person.context_manual_override}<span class="badge">manual</span>{/if}
        </h3>
        {#if !isEditing('context')}
          <button class="btn small ghost" onclick={() => startEdit('context')}>
            edit
          </button>
        {/if}
      </header>
      {#if isEditing('context')}
        <textarea bind:value={editValues.context} rows="6"></textarea>
        <div class="row">
          <button class="btn btn-primary" onclick={() => saveField('context')}>Save</button>
          <button class="btn ghost" onclick={() => cancelEdit('context')}>Cancel</button>
        </div>
      {:else}
        {@const ctx = splitDateMarker(view.person.context)}
        <div class="prose context-body">
          {#if ctx.date}<span class="datepill">{ctx.date}</span>{/if}<span class="ctx-text">{ctx.rest || '—'}</span>
        </div>
      {/if}
    </section>
  {/if}

  <!-- ======================================================== NEEDS / OFFERS -->
  <!-- Inline `grid-column: 1` / `grid-column: 2` pin each card to its
       column so Offers stays on the right even when Needs is hidden. The
       mobile media query at the bottom of the file overrides both back
       to column 1 for the single-column layout. -->
  {#if visibleCard('needs') || visibleCard('offers')}
    <div class="grid2">
      {#if visibleCard('needs')}
        <section class="card need-card" style="grid-column: 1;">
          <header class="card-hd">
            <h3><span class="hd-dot need-dot"></span>Needs</h3>
            {#if !isEditing('needs')}
              <button class="btn small ghost" onclick={() => startEdit('needs')}>edit</button>
            {/if}
          </header>
          {#if isEditing('needs')}
            <textarea bind:value={editValues.needs} rows="4"></textarea>
            <div class="row">
              <button class="btn btn-primary" onclick={() => saveField('needs')}>Save</button>
              <button class="btn ghost" onclick={() => cancelEdit('needs')}>Cancel</button>
            </div>
          {:else}
            <p class="prose">{view.person.needs}</p>
          {/if}
        </section>
      {/if}
      {#if visibleCard('offers')}
        <section class="card offer-card" style="grid-column: 2;">
          <header class="card-hd">
            <h3><span class="hd-dot offer-dot"></span>Offers</h3>
            {#if !isEditing('offers')}
              <button class="btn small ghost" onclick={() => startEdit('offers')}>edit</button>
            {/if}
          </header>
          {#if isEditing('offers')}
            <textarea bind:value={editValues.offers} rows="4"></textarea>
            <div class="row">
              <button class="btn btn-primary" onclick={() => saveField('offers')}>Save</button>
              <button class="btn ghost" onclick={() => cancelEdit('offers')}>Cancel</button>
            </div>
          {:else}
            <p class="prose">{view.person.offers}</p>
          {/if}
        </section>
      {/if}
    </div>
  {/if}

  <!-- ======================================================== SIGNALS -->
  {#if editingHeader || view.recentSignals.length > 0}
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
              <span class="kind k-{s.kind}">{signalKindLabel(s.kind)}</span>
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
  {/if}

  <!-- ======================================================== RECENT MEETINGS -->
  {#if editingHeader || view.recentMeetings.length > 0}
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
  {/if}

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
              <button class="row-del" onclick={() => deleteFollowup(f.id)} aria-label="Delete followup" title="Delete">
                <Icon name="trash" size={12} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Add a new followup. Hidden behind a subtle right-aligned button. -->
      {#if addingFollowup}
        <div class="followup-new">
          <input
            class="new-body"
            type="text"
            placeholder="Add a followup…"
            bind:value={newFollowupBody}
            onkeydown={(e) => {
              if (e.key === 'Enter') createFollowup();
              if (e.key === 'Escape') {
                addingFollowup = false;
                newFollowupBody = '';
                newFollowupDue = '';
              }
            }}
            disabled={creatingFollowup}
            autofocus
          />
          <input
            class="new-due"
            type="date"
            bind:value={newFollowupDue}
            disabled={creatingFollowup}
            aria-label="Due date (optional)"
          />
          <button
            class="btn btn-primary small"
            onclick={createFollowup}
            disabled={creatingFollowup || !newFollowupBody.trim()}
          >
            {creatingFollowup ? '…' : 'Add'}
          </button>
          <button
            class="btn small"
            onclick={() => { addingFollowup = false; newFollowupBody = ''; newFollowupDue = ''; }}
            disabled={creatingFollowup}
          >Cancel</button>
        </div>
      {:else}
        <div class="followup-add-row">
          <button class="btn small subtle" onclick={() => (addingFollowup = true)}>
            + followup
          </button>
        </div>
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
              <button class="row-del" onclick={() => deleteFollowup(f.id)} aria-label="Delete followup" title="Delete">
                <Icon name="trash" size={12} />
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </section>

  <!-- ======================================================== CHAT -->
  <section class="card chat-card" class:collapsed={!chatHistoryVisible}>
    {#if chatHistoryVisible}
      <header class="card-hd">
        <h3><span class="hd-dot chat-dot"></span>Per-person chat</h3>
        <button class="btn small ghost" onclick={() => (chatThreadId = ulid())}>
          <Icon name="plus" size={12} /> new
        </button>
      </header>
    {/if}
    <div class="chatbox" class:collapsed={!chatHistoryVisible}>
      {#if chatThreadId}
        <ChatPane
          scope="person"
          personId={view.person.id}
          threadId={chatThreadId}
          bind:historyVisible={chatHistoryVisible}
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
  /* Corner ribbon for non-default connection degree. The mask is a
     square overlay anchored to the hero card's TOP-LEFT corner. It uses
     overflow:hidden + a matching border-top-left-radius so the band's
     ends are cleanly clipped at the card's edges, giving the
     "wrapped around the corner" look instead of a floating diagonal.
     degree=0 → indigo "You"; degree=2 → amber "Distant"; degree=1
     renders nothing. */
  .ribbon-mask {
    position: absolute;
    top: 0;
    left: 0;
    width: 110px;
    height: 110px;
    overflow: hidden;
    border-top-left-radius: 12px; /* match .hero radius */
    pointer-events: none;
    z-index: 2;
  }
  .corner-band {
    position: absolute;
    top: 24px;
    left: -40px;
    width: 160px;
    text-align: center;
    transform: rotate(-45deg);
    transform-origin: center;
    padding: 4px 0;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: white;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
  }
  .band-you { background: var(--accent); }
  .band-distant { background: #d97706; } /* amber */
  /* Visually-hidden helper for screen readers (the mask is aria-hidden). */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  /* Degree-edit row in editingHeader mode. Indents off the meta line
     enough to feel like a separate control, not another stat cell. */
  .degree-cell {
    gap: 8px;
  }
  .degree-label {
    font-weight: 600;
    color: var(--fg);
  }

  /* ──────────────────────────────────────────── hero */
  .hero {
    position: relative; /* anchors .ribbon-mask */
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
  .row-del {
    background: transparent;
    border: 0;
    padding: 4px;
    border-radius: 4px;
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .followup-row:hover .row-del { opacity: 1; }
  .row-del:hover { color: var(--danger); background: var(--hover); }
  .followup-new {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--border);
  }
  .followup-new .new-body { flex: 1; }
  .followup-new .new-due { width: 150px; }
  .followup-add-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 6px;
  }
  .btn.subtle {
    background: transparent;
    color: var(--muted);
    border: 1px dashed var(--border);
  }
  .btn.subtle:hover {
    background: var(--hover);
    color: var(--text);
  }
  @media (max-width: 720px) {
    .followup-new { flex-direction: column; align-items: stretch; }
    .followup-new .new-due { width: 100%; }
  }

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

  /* ──────────────────────────────────────────── aux dropdown */
  .aux-wrap { position: relative; }
  .aux-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 180px;
    background: white;
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.10);
    padding: 4px;
    z-index: 20;
    display: flex;
    flex-direction: column;
  }
  .aux-item {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    font-size: 13px;
    color: var(--text);
  }
  .aux-item:hover { background: var(--hover); }
  .aux-item.danger { color: #b91c1c; }
  .aux-item.danger:hover { background: #fef2f2; }

  /* ──────────────────────────────────────────── chat */
  /* Sticky to the bottom of the right-pane viewport so the composer is
     always reachable no matter where the user has scrolled in the profile.
     The message history scrolls inside .chatbox; only the chat-card itself
     is pinned. Bottom is pulled flush via negative margins on the card,
     so the composer sits at the very bottom edge of the viewport. */
  .chat-card {
    padding-bottom: 0;
    position: sticky;
    bottom: 0;
    z-index: 5;
    background: white;
    box-shadow: 0 -8px 24px rgba(0, 0, 0, 0.06);
  }
  /* In collapsed mode the card has no header and only the composer row.
     Strip its top/side padding so the composer sits flush at the bottom
     edge of the viewport. */
  .chat-card.collapsed {
    padding: 0;
    border-top: 1px solid var(--border);
  }
  /* When the history is shown, give it room to scroll. When collapsed,
     the chatbox shrinks to whatever the composer needs. */
  .chatbox {
    height: 360px;
    border-top: 1px solid var(--border);
    margin: 0 -16px -16px;
    overflow: hidden;
    transition: height 160ms ease;
  }
  .chatbox.collapsed {
    height: auto;
    border-top: 0;
    margin: 0;
  }
  /* Round only the bottom corners since the chatbox is flush with the card edge. */
  .chat-card .chatbox {
    border-bottom-left-radius: 12px;
    border-bottom-right-radius: 12px;
  }

  /* ──────────────────────────────────────────── responsive */
  @media (max-width: 720px) {
    .grid2 { grid-template-columns: 1fr; }
    /* Override the inline grid-column on need-card / offer-card so the
       single-column mobile layout doesn't push Offers into a phantom
       second column. */
    .grid2 > .card { grid-column: 1 !important; }
    .chatbox { height: 320px; }
    .hero { padding: 16px; flex-direction: column; }
    .timeline-row { grid-template-columns: 1fr; }
    .timeline-rail { justify-content: flex-start; }
    .signal-row { grid-template-columns: 86px 1fr; }
    .signal-row .confidence { grid-column: 2; justify-self: start; }
  }
</style>
