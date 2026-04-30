<script lang="ts">
  import { api } from '$lib/api';
  import { goto } from '$app/navigation';
  import type { PersonView, TagRow, ChatThread } from '$lib/types';
  import { ulid } from '$lib/ulid';
  import ChatPane from './ChatPane.svelte';
  import Icon from './Icon.svelte';
  import MergeModal from './MergeModal.svelte';

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
    // Re-fetch the kept person view so the merged context/aliases show up.
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

  async function completeFollowup(id: string) {
    await api.post(`/api/followups/${id}/complete`, { status: 'done' });
    await onChanged();
  }
</script>

<div class="profile">
  <header class="hd">
    <div class="title-row">
      <h1>{view.person.display_name ?? '(unnamed)'}</h1>
      <span class="spacer"></span>
      <button class="btn small" onclick={() => (mergeOpen = true)} title="Merge a duplicate into this person">
        <Icon name="merge" size={14} /> Merge with…
      </button>
    </div>
    <div class="muted small">
      {#if view.person.primary_email}{view.person.primary_email}{/if}
      {#if view.person.geo} · {view.person.geo}{/if}
      · last met {view.person.last_met_date ?? '—'}
      · {view.person.meeting_count} meeting{view.person.meeting_count === 1 ? '' : 's'}
    </div>
    <div class="rolerow">
      {#each view.roles as r}<span class="chip active">{r}</span>{/each}
      {#each view.trajectoryTags as t}<span class="chip">{t}</span>{/each}
    </div>
  </header>

  <section>
    <h3>Tags</h3>
    <div class="tagrow">
      {#each view.tags as t}
        <span class="chip">{t}<button onclick={() => removeTag(t)} aria-label="remove">×</button></span>
      {/each}
      <input
        list="tag-options"
        bind:value={newTagName}
        placeholder="add tag…"
        onkeydown={(e) => e.key === 'Enter' && addTag()}
      />
      <datalist id="tag-options">
        {#each allTags as t}<option value={t.name}></option>{/each}
      </datalist>
    </div>
  </section>

  <section>
    <h3>
      Context
      {#if view.person.context_manual_override}<span class="muted small">(manual)</span>{/if}
      <button class="btn small" onclick={() => startEdit('context')}>edit</button>
    </h3>
    {#if editing === 'context'}
      <textarea bind:value={editValue} rows="6"></textarea>
      <div class="row">
        <button class="btn btn-primary" onclick={saveEdit}>save</button>
        <button class="btn" onclick={() => (editing = null)}>cancel</button>
      </div>
    {:else}
      <p class="prose">{view.person.context ?? '—'}</p>
    {/if}
  </section>

  <div class="grid2">
    <section>
      <h3>Needs <button class="btn small" onclick={() => startEdit('needs')}>edit</button></h3>
      {#if editing === 'needs'}
        <textarea bind:value={editValue} rows="4"></textarea>
        <div class="row">
          <button class="btn btn-primary" onclick={saveEdit}>save</button>
          <button class="btn" onclick={() => (editing = null)}>cancel</button>
        </div>
      {:else}
        <p class="prose">{view.person.needs ?? '—'}</p>
      {/if}
    </section>
    <section>
      <h3>Offers <button class="btn small" onclick={() => startEdit('offers')}>edit</button></h3>
      {#if editing === 'offers'}
        <textarea bind:value={editValue} rows="4"></textarea>
        <div class="row">
          <button class="btn btn-primary" onclick={saveEdit}>save</button>
          <button class="btn" onclick={() => (editing = null)}>cancel</button>
        </div>
      {:else}
        <p class="prose">{view.person.offers ?? '—'}</p>
      {/if}
    </section>
  </div>

  <section>
    <h3>Recent meetings</h3>
    {#if view.recentMeetings.length === 0}
      <p class="muted">No meetings yet.</p>
    {:else}
      <ul class="meetings">
        {#each view.recentMeetings as m}
          <li>
            <div class="muted small">{m.recorded_at.slice(0, 10)} · {m.source} · {m.classification}</div>
            <div>{m.summary ?? '—'}</div>
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h3>Signals</h3>
    {#if view.recentSignals.length === 0}
      <p class="muted">No signals yet.</p>
    {:else}
      <ul class="signals">
        {#each view.recentSignals as s}
          <li>
            <span class="kind">{s.kind}</span>
            <span class="conf small muted">({s.confidence?.toFixed(2) ?? '—'})</span>
            {s.body}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section>
    <h3>Open followups</h3>
    {#if view.openFollowups.length === 0}
      <p class="muted">None.</p>
    {:else}
      <ul class="followups">
        {#each view.openFollowups as f}
          <li>
            <input type="checkbox" onchange={() => completeFollowup(f.id)} />
            {f.body}
            {#if f.due_date}<span class="muted small">due {f.due_date}</span>{/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section class="chat">
    <h3>
      Per-person chat
      <button class="btn small" onclick={() => (chatThreadId = ulid())}>new</button>
    </h3>
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
    }}
    onClose={() => (mergeOpen = false)}
    onMerged={() => onMerged()}
  />
{/if}

<style>
  .profile {
    display: flex;
    flex-direction: column;
    gap: 24px;
    max-width: 920px;
  }
  .hd h1 { margin: 0; }
  .title-row { display: flex; align-items: center; gap: 8px; }
  .rolerow { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 4px; }
  .tagrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  h3 { display: flex; gap: 8px; align-items: center; margin: 0 0 8px 0; font-size: 14px; }
  textarea { width: 100%; }
  .prose { white-space: pre-wrap; margin: 0; }
  .meetings, .signals, .followups { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 8px; }
  .signals .kind {
    font-size: 11px;
    text-transform: uppercase;
    background: var(--hover);
    border-radius: 4px;
    padding: 1px 4px;
    margin-right: 4px;
  }
  .chatbox {
    height: 360px;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: white;
    overflow: hidden;
  }

  @media (max-width: 720px) {
    .grid2 { grid-template-columns: 1fr; }
    .chatbox { height: 320px; }
    h3 { flex-wrap: wrap; }
    .rolerow, .tagrow { gap: 6px; }
  }
</style>
