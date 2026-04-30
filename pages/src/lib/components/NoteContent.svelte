<script lang="ts">
  // Tabbed Granola note content: Summary (default) and Transcript. Used in
  // the Notes detail pane so pending / processed / dismissed all show the
  // same note info in the same place.
  import TranscriptView from './TranscriptView.svelte';

  interface Props {
    summary: string | null | undefined;
    transcript: string | null | undefined;
    /** Optional preview-warning suffix when transcript is truncated. */
    transcriptIsPreview?: boolean;
  }
  let { summary, transcript, transcriptIsPreview = false }: Props = $props();

  let active = $state<'summary' | 'transcript'>('summary');
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
      {#if summary}
        <div class="prose summary-scroll">{summary}</div>
      {:else}
        <div class="muted small">No summary on this note.</div>
      {/if}
    {:else}
      <TranscriptView text={transcript} maxHeight="25vh" />
      {#if transcriptIsPreview}
        <div class="muted small preview-note">Showing the first 1500 chars; full transcript loads on demand.</div>
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
