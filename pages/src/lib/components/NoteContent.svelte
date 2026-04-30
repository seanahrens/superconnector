<script lang="ts">
  // Tabbed Granola note content: Summary (default) and Transcript. Used in
  // the Notes detail pane so pending / processed / dismissed all show the
  // same note info in the same place. When `noteId` is provided, lazily
  // fetches the full body (summary + un-truncated transcript) from
  // /api/notes/:noteId on mount, replacing whatever cheap preview the
  // parent passed in.
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import TranscriptView from './TranscriptView.svelte';

  interface Props {
    summary: string | null | undefined;
    transcript: string | null | undefined;
    /** Granola note id; when present, full content is fetched lazily. */
    noteId?: string | null;
  }
  let { summary, transcript, noteId }: Props = $props();

  let active = $state<'summary' | 'transcript'>('summary');
  let liveSummary = $state<string | null | undefined>(summary);
  let liveTranscript = $state<string | null | undefined>(transcript);
  let loading = $state(false);

  // Re-sync when the parent passes a different note (e.g. user clicks a
  // different list item). Run an initial fetch when noteId is present.
  let lastFetchedId = $state<string | null>(null);
  $effect(() => {
    liveSummary = summary;
    liveTranscript = transcript;
    if (noteId && noteId !== lastFetchedId) {
      lastFetchedId = noteId;
      void fetchFull(noteId);
    }
  });

  async function fetchFull(id: string) {
    loading = true;
    try {
      const r = await api.get<{ summary: string | null; transcript: string | null }>(`/api/notes/${encodeURIComponent(id)}`);
      // Only swap if values are non-null and longer/different from what
      // we have — never blank a populated preview.
      if (r.summary && r.summary.length > (liveSummary?.length ?? 0)) liveSummary = r.summary;
      if (r.transcript && r.transcript.length > (liveTranscript?.length ?? 0)) liveTranscript = r.transcript;
    } catch {
      /* ignore — preview stays */
    } finally {
      loading = false;
    }
  }

  // Heuristic: parent passes a 1500-char preview from the queue payload.
  // After the lazy fetch, if the live transcript is longer, the preview
  // warning goes away. The boolean below drives the "Showing first…" hint.
  const isPreview = $derived(
    !!liveTranscript && (liveTranscript.length === 1500 || liveTranscript.endsWith('…')),
  );
</script>

<div class="note-tabs">
  <div class="tablist" role="tablist">
    <button
      role="tab"
      aria-selected={active === 'summary'}
      class="tab"
      class:active={active === 'summary'}
      onclick={() => (active = 'summary')}
    >Summary</button>
    <button
      role="tab"
      aria-selected={active === 'transcript'}
      class="tab"
      class:active={active === 'transcript'}
      onclick={() => (active = 'transcript')}
    >Transcript</button>
  </div>

  <div class="panel">
    {#if active === 'summary'}
      {#if liveSummary}
        <div class="prose summary-scroll">{liveSummary}</div>
      {:else if loading}
        <div class="muted small">Loading…</div>
      {:else}
        <div class="muted small">No summary on this note.</div>
      {/if}
    {:else}
      <TranscriptView text={liveTranscript} maxHeight="25vh" />
      {#if isPreview && loading}
        <div class="muted small preview-note">Loading full transcript…</div>
      {/if}
    {/if}
  </div>
</div>

<style>
  .note-tabs {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: white;
    overflow: hidden;
  }
  .tablist {
    display: flex;
    border-bottom: 1px solid var(--border);
    background: var(--hover);
  }
  .tab {
    flex: 1;
    background: none;
    border: 0;
    padding: 10px 12px;
    font: inherit;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    font-size: 13px;
  }
  .tab:hover { color: var(--fg); }
  .tab.active { color: var(--fg); border-bottom-color: var(--accent); background: white; }
  .panel { padding: 12px; }
  .summary-scroll {
    max-height: 25vh;
    overflow-y: auto;
    white-space: pre-wrap;
    line-height: 1.55;
  }
  .preview-note { margin-top: 6px; }
</style>
