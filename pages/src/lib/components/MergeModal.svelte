<script lang="ts">
  import { api } from '$lib/api';
  import type { PersonListItem } from '$lib/types';
  import Icon from './Icon.svelte';

  interface MergeCandidate {
    person_id: string;
    display_name: string | null;
    primary_email: string | null;
    last_met_date: string | null;
    meeting_count: number;
    aliases: string[];
    roles?: string[];
    context?: string | null;
    needs?: string | null;
    offers?: string | null;
    score: number;
    reasons: string[];
  }

  interface PersonShape {
    person_id: string;
    display_name: string | null;
    primary_email: string | null;
    last_met_date: string | null;
    meeting_count: number;
    aliases?: string[];
    roles?: string[];
    context?: string | null;
    needs?: string | null;
    offers?: string | null;
  }

  interface Props {
    keepPerson: PersonShape;
    onClose: () => void;
    onMerged: (donorId: string) => void;
  }
  let { keepPerson, onClose, onMerged }: Props = $props();

  let candidates = $state<MergeCandidate[]>([]);
  let allPeople = $state<PersonListItem[]>([]);
  let q = $state('');
  let selected = $state<MergeCandidate | PersonShape | null>(null);
  let confirming = $state(false);
  let error = $state<string | null>(null);
  let loading = $state(true);

  $effect(() => { void load(); });

  async function load() {
    loading = true;
    try {
      const [cand, all] = await Promise.all([
        api.get<{ items: MergeCandidate[] }>(`/api/people/${keepPerson.person_id}/merge-candidates`),
        api.get<{ items: PersonListItem[] }>(`/api/people?sort=alpha&limit=500`),
      ]);
      candidates = cand.items;
      allPeople = all.items.filter((p) => p.person_id !== keepPerson.person_id);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      loading = false;
    }
  }

  const filteredAll = $derived.by(() => {
    if (!q.trim()) return allPeople;
    const needle = q.toLowerCase();
    return allPeople.filter((p) =>
      [p.display_name, p.email].filter(Boolean).join(' ').toLowerCase().includes(needle),
    );
  });

  function selectCandidate(c: MergeCandidate) {
    selected = c;
  }
  function selectPerson(p: PersonListItem) {
    selected = {
      person_id: p.person_id,
      display_name: p.display_name,
      primary_email: p.email,
      last_met_date: p.last_met_date,
      meeting_count: p.meeting_count,
      aliases: [],
    };
  }

  async function performMerge() {
    if (!selected) return;
    confirming = true;
    error = null;
    try {
      await api.post(`/api/people/${keepPerson.person_id}/merge`, { donor_id: selected.person_id });
      onMerged(selected.person_id);
    } catch (err) {
      error = (err as Error).message;
    } finally {
      confirming = false;
    }
  }
</script>

<button class="scrim" onclick={onClose} aria-label="close"></button>
<div class="modal" role="dialog" aria-modal="true">
  <header class="hd">
    <h2>Merge into {keepPerson.display_name ?? keepPerson.primary_email ?? 'this person'}</h2>
    <span class="spacer"></span>
    <button class="btn icon-only" onclick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
  </header>

  <div class="body">
    {#if loading}
      <div class="muted">loading candidates…</div>
    {:else}
      <section>
        <h3>Suggested candidates</h3>
        {#if candidates.length === 0}
          <p class="muted small">No good matches by name/email. Pick one from the full list below.</p>
        {:else}
          <ul class="cand-list">
            {#each candidates as c (c.person_id)}
              <li>
                <button
                  class="row"
                  class:selected={selected?.person_id === c.person_id}
                  onclick={() => selectCandidate(c)}
                >
                  <span class="name">{c.display_name ?? '(unnamed)'}</span>
                  <span class="email muted small">{c.primary_email ?? '—'}</span>
                  <span class="score muted small">score {c.score}</span>
                  <span class="reasons muted small">{c.reasons.join(' · ')}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section>
        <h3>Or pick from all people ({allPeople.length})</h3>
        <input type="search" placeholder="Search name or email…" bind:value={q} />
        <ul class="all-list">
          {#each filteredAll.slice(0, 200) as p (p.person_id)}
            <li>
              <button
                class="row"
                class:selected={selected?.person_id === p.person_id}
                onclick={() => selectPerson(p)}
              >
                <span class="name">{p.display_name ?? '(unnamed)'}</span>
                <span class="email muted small">{p.email ?? '—'}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>

      {#if selected}
        <section class="confirm">
          <h3>Side-by-side</h3>
          <div class="diff">
            <div class="col">
              <div class="col-label">Keep (this person)</div>
              <div class="card-name"><strong>{keepPerson.display_name ?? '(unnamed)'}</strong></div>
              <div class="muted small">{keepPerson.primary_email ?? '—'}</div>
              <div class="muted small">last met {keepPerson.last_met_date ?? '—'} · {keepPerson.meeting_count} meeting{keepPerson.meeting_count === 1 ? '' : 's'}</div>
              {#if keepPerson.roles?.length}
                <div class="chips">
                  {#each keepPerson.roles as r}<span class="chip role">{r}</span>{/each}
                </div>
              {/if}
              {#if keepPerson.context}
                <div class="field">
                  <div class="field-label">Context</div>
                  <p class="prose">{keepPerson.context}</p>
                </div>
              {/if}
              {#if keepPerson.needs}
                <div class="field">
                  <div class="field-label">Needs</div>
                  <p class="prose">{keepPerson.needs}</p>
                </div>
              {/if}
              {#if keepPerson.offers}
                <div class="field">
                  <div class="field-label">Offers</div>
                  <p class="prose">{keepPerson.offers}</p>
                </div>
              {/if}
            </div>
            <div class="arrow" aria-hidden="true">←</div>
            <div class="col donor">
              <div class="col-label">Donor (will be deleted)</div>
              <div class="card-name"><strong>{selected.display_name ?? '(unnamed)'}</strong></div>
              <div class="muted small">{selected.primary_email ?? '—'}</div>
              <div class="muted small">last met {selected.last_met_date ?? '—'} · {selected.meeting_count} meeting{selected.meeting_count === 1 ? '' : 's'}</div>
              {#if (selected as MergeCandidate).roles?.length}
                <div class="chips">
                  {#each (selected as MergeCandidate).roles ?? [] as r}<span class="chip role">{r}</span>{/each}
                </div>
              {/if}
              {#if (selected as MergeCandidate).context}
                <div class="field">
                  <div class="field-label">Context</div>
                  <p class="prose">{(selected as MergeCandidate).context}</p>
                </div>
              {/if}
              {#if (selected as MergeCandidate).needs}
                <div class="field">
                  <div class="field-label">Needs</div>
                  <p class="prose">{(selected as MergeCandidate).needs}</p>
                </div>
              {/if}
              {#if (selected as MergeCandidate).offers}
                <div class="field">
                  <div class="field-label">Offers</div>
                  <p class="prose">{(selected as MergeCandidate).offers}</p>
                </div>
              {/if}
            </div>
          </div>
          <p class="muted small note">
            All meetings, signals, followups, tags and chat threads on the
            donor will be moved to the kept record. The donor row is then
            deleted; this can't be undone without restoring from backup.
          </p>
          {#if error}
            <div class="error">{error}</div>
          {/if}
          <div class="actions">
            <button class="btn btn-primary" onclick={performMerge} disabled={confirming}>
              {confirming ? 'merging…' : 'Confirm merge'}
            </button>
            <button class="btn" onclick={() => (selected = null)} disabled={confirming}>cancel</button>
          </div>
        </section>
      {/if}
    {/if}
  </div>
</div>

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 200;
    border: 0;
    padding: 0;
    cursor: default;
  }
  .modal {
    position: fixed;
    z-index: 201;
    inset: 5vh 50% auto 50%;
    transform: translateX(-50%);
    width: min(720px, 96vw);
    max-height: 90vh;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.18);
    display: grid;
    grid-template-rows: auto 1fr;
    overflow: hidden;
  }
  .hd {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: white;
  }
  .hd h2 { margin: 0; font-size: 16px; }
  .body { overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 16px; }
  section h3 { margin: 0 0 8px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }

  .cand-list, .all-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .all-list { max-height: 30vh; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 4px; background: white; }

  .row {
    display: grid;
    grid-template-columns: 1fr 1.5fr 60px;
    gap: 8px;
    align-items: baseline;
    width: 100%;
    text-align: left;
    background: white;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 8px 10px;
    color: inherit;
    cursor: pointer;
  }
  .all-list .row { grid-template-columns: 1fr 1.5fr; border: 0; padding: 6px 8px; }
  .row:hover { background: var(--hover); }
  .row.selected { border-color: var(--accent); background: rgba(67,56,202,0.06); }
  .name { font-weight: 500; }
  .reasons { grid-column: 1 / -1; }
  .score { white-space: nowrap; text-align: right; }

  .diff {
    display: grid;
    grid-template-columns: 1fr 24px 1fr;
    gap: 12px;
    align-items: stretch;
  }
  .col {
    padding: 14px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: white;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 60vh;
    overflow-y: auto;
  }
  .col.donor { background: #fff7f4; border-color: rgba(185, 28, 28, 0.15); }
  .col-label { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.05em; font-weight: 600; }
  .card-name { font-size: 16px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
  .chip.role {
    background: var(--accent);
    color: white;
    border-color: var(--accent);
  }
  .field { margin-top: 4px; }
  .field-label { font-size: 11px; text-transform: uppercase; color: var(--muted); letter-spacing: 0.04em; margin-bottom: 2px; }
  .prose { white-space: pre-wrap; margin: 0; line-height: 1.45; font-size: 13px; }
  .arrow { display: flex; align-items: center; justify-content: center; color: var(--muted); }
  .note { margin-top: 8px; }
  .error {
    color: #7a1e1e;
    background: #fff4f4;
    border: 1px solid #f0c0c0;
    border-radius: 6px;
    padding: 8px;
    margin-top: 8px;
    font-size: 13px;
  }
  .actions { display: flex; gap: 8px; margin-top: 8px; }

  @media (max-width: 720px) {
    .modal { inset: 0; transform: none; max-height: 100vh; border-radius: 0; width: 100vw; }
    .row { grid-template-columns: 1fr; }
    .row .email, .row .score { text-align: left; }
    .diff { grid-template-columns: 1fr; }
    .arrow { transform: rotate(90deg); }
  }
</style>
