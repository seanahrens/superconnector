<script lang="ts">
  // One want row: body · 3-dot evidence · age. Click to expand the source
  // quote inline. Hover the dots for a legend tooltip (native title).

  import { fmtShortDate } from '$lib/dates';

  type Evidence = 'explicit' | 'inferred' | 'weak';

  interface Props {
    body: string;
    evidence?: Evidence | null;
    sourceSpan?: string | null;
    /** When the underlying signal was last reaffirmed (or first captured). */
    lastValidatedAt?: string | null;
    createdAt?: string | null;
    /** When true, dim the row — used to indicate the want is older than
     *  the person's last_met_date (likely stale). The decision is made by
     *  the caller; this component just renders. */
    dim?: boolean;
  }
  let { body, evidence = null, sourceSpan = null, lastValidatedAt = null, createdAt = null, dim = false }: Props = $props();

  let expanded = $state(false);
  function toggle() {
    if (sourceSpan) expanded = !expanded;
  }

  // Compact age label: 3d / 2w / 4mo / 1y. Anchored to last_validated_at
  // when present, otherwise created_at.
  function ageLabel(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return null;
    const diffMs = Date.now() - t;
    const days = Math.max(0, Math.round(diffMs / 86_400_000));
    if (days < 1) return 'today';
    if (days < 14) return `${days}d`;
    const weeks = Math.round(days / 7);
    if (weeks < 9) return `${weeks}w`;
    const months = Math.round(days / 30);
    if (months < 18) return `${months}mo`;
    const years = Math.round(days / 365);
    return `${years}y`;
  }

  let age = $derived(ageLabel(lastValidatedAt ?? createdAt));

  // Legend explaining the 3-dot evidence indicator. Native browser tooltip
  // — accessible, zero-JS, works on both hover and long-press.
  const EVIDENCE_LEGEND =
    'Evidence:\n' +
    '●●●  Explicit — they said it directly\n' +
    '●●○  Inferred — derived from surrounding context\n' +
    '●○○  Weak — mentioned in passing or hedged';

  function dots(ev: Evidence | null): string {
    if (ev === 'explicit') return '●●●';
    if (ev === 'inferred') return '●●○';
    if (ev === 'weak') return '●○○';
    return '○○○';
  }

  // Whether the row is clickable (has something to disclose).
  let clickable = $derived(!!sourceSpan);
</script>

<div class="want" class:dim class:expanded class:clickable>
  <button
    type="button"
    class="want-line"
    aria-expanded={expanded}
    disabled={!clickable}
    onclick={toggle}
  >
    <span class="body">{body}</span>
    <span class="meta">
      {#if evidence}
        <span class="dots ev-{evidence}" title={EVIDENCE_LEGEND} aria-label="Evidence: {evidence}">{dots(evidence)}</span>
      {/if}
      {#if age}
        <span class="age" title={lastValidatedAt && createdAt && lastValidatedAt !== createdAt
          ? `validated ${fmtShortDate(lastValidatedAt)} (first seen ${fmtShortDate(createdAt)})`
          : (lastValidatedAt ? `as of ${fmtShortDate(lastValidatedAt)}` : (createdAt ? fmtShortDate(createdAt) : ''))}>{age}</span>
      {/if}
    </span>
  </button>
  {#if expanded && sourceSpan}
    <blockquote class="quote">{sourceSpan}</blockquote>
  {/if}
</div>

<style>
  .want {
    border-bottom: 1px solid var(--hover);
    padding: 6px 0;
  }
  .want:last-child { border-bottom: 0; }
  .want.dim { opacity: 0.6; }

  .want-line {
    appearance: none;
    width: 100%;
    background: transparent;
    border: 0;
    padding: 0;
    text-align: left;
    font: inherit;
    color: inherit;
    display: flex;
    align-items: baseline;
    gap: 12px;
    cursor: default;
  }
  .want.clickable .want-line { cursor: pointer; }
  .want.clickable .want-line:hover .body { color: var(--accent); }

  .body {
    flex: 1;
    line-height: 1.45;
    color: var(--fg);
  }
  .meta {
    display: inline-flex;
    align-items: baseline;
    gap: 8px;
    color: var(--muted);
    font-size: 11px;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .dots {
    letter-spacing: -0.05em;
    cursor: help;
    /* Subtle color shift per evidence so the dots don't all read the same
       hue. Stays muted to keep the row glanceable. */
  }
  .ev-explicit { color: #16a34a; }
  .ev-inferred { color: var(--muted); }
  .ev-weak     { color: #94a3b8; }
  .age { white-space: nowrap; }

  .quote {
    margin: 6px 0 4px 0;
    padding: 6px 10px;
    border-left: 2px solid var(--border);
    color: var(--muted);
    font-size: 13px;
    line-height: 1.4;
    background: var(--hover);
    border-radius: 0 4px 4px 0;
  }
</style>
