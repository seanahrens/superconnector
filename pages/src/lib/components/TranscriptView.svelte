<script lang="ts">
  // Render a Granola transcript stored as "[label] text" lines (one per turn,
  // see transcriptToString in src/lib/granola.ts) as a two-column conversation:
  // speaker label on the left, utterance on the right. Bracketed labels are
  // re-mapped — `microphone` → "You" (the user, mic-side audio) and
  // `speaker` → "Them" (other party, speaker-side audio). Anything else
  // passes through (e.g. real diarized names, "Speaker A").

  interface Props {
    text: string | null | undefined;
    /** Cap height; turns into a vertical scroll region when content overflows. */
    maxHeight?: string;
  }
  let { text, maxHeight = '25vh' }: Props = $props();

  const LABEL_MAP: Record<string, string> = {
    microphone: 'You',
    speaker: 'Them',
  };

  function pretty(raw: string): string {
    const lo = raw.trim().toLowerCase();
    return LABEL_MAP[lo] ?? raw.trim();
  }

  // [{ label, text }] — one entry per line. Lines without a "[label]" prefix
  // get an empty label and span the full row right column.
  const turns = $derived.by(() => {
    if (!text) return [] as Array<{ label: string; speech: string }>;
    const out: Array<{ label: string; speech: string }> = [];
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue;
      const m = raw.match(/^\[([^\]]+)\]\s?(.*)$/);
      if (m) {
        out.push({ label: pretty(m[1] ?? ''), speech: m[2] ?? '' });
      } else {
        out.push({ label: '', speech: raw });
      }
    }
    return out;
  });
</script>

<div class="transcript" style="max-height: {maxHeight}">
  {#if turns.length === 0}
    <div class="empty muted small">No transcript.</div>
  {:else}
    <div class="grid">
      {#each turns as t, i (i)}
        <div class="label" class:you={t.label === 'You'} class:them={t.label === 'Them'}>{t.label}</div>
        <div class="speech">{t.speech}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .transcript {
    overflow-y: auto;
    border: 1px solid var(--border);
    background: white;
    border-radius: 8px;
    padding: 8px 10px;
    font-size: 13px;
    line-height: 1.55;
  }
  .grid {
    display: grid;
    grid-template-columns: 56px 1fr;
    column-gap: 12px;
    row-gap: 4px;
    align-items: start;
  }
  .label {
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding-top: 2px;
    text-align: right;
    user-select: none;
  }
  .label.you { color: var(--accent); }
  .label.them { color: #1f7a8c; }
  .speech {
    white-space: pre-wrap;
    word-wrap: break-word;
  }
  .empty { padding: 4px; }

  @media (max-width: 720px) {
    .grid { grid-template-columns: 44px 1fr; column-gap: 8px; }
    .label { font-size: 10px; }
  }
</style>
