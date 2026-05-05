<script lang="ts">
  // Stacked-bar evidence indicator. Three horizontal bars; bars fill from
  // the bottom up — like a battery — based on evidence level. Monochrome
  // gray on purpose: keeps the row glanceable without competing with the
  // information itself. Tooltip legend lives on the wrapping element via
  // native `title` (zero-JS, accessible by long-press on touch).

  type Evidence = 'explicit' | 'inferred' | 'weak' | null | undefined;

  interface Props {
    evidence: Evidence;
    /** Visual size in px (the bars scale with this). */
    size?: number;
  }
  let { evidence, size = 12 }: Props = $props();

  // How many of the three bars are filled, counting from the bottom.
  function filledCount(ev: Evidence): number {
    if (ev === 'explicit') return 3;
    if (ev === 'inferred') return 2;
    if (ev === 'weak') return 1;
    return 0;
  }

  let filled = $derived(filledCount(evidence));

  const TOOLTIP =
    'Evidence:\n' +
    '▰▰▰  Explicit — they said it directly\n' +
    '▱▰▰  Inferred — derived from surrounding context\n' +
    '▱▱▰  Weak — mentioned in passing or hedged';

  let label = $derived(evidence ? `Evidence: ${evidence}` : 'Evidence: unknown');

  // ViewBox is 50% wider than tall — makes the bars read as bars, not
  // squares. `size` controls the *height*; width derives at 1.25× to match
  // the viewBox aspect.
  const W = 15;
  const H = 12;
</script>

<span class="ev" title={TOOLTIP} aria-label={label}>
  <svg viewBox="0 0 {W} {H}" width={size * 1.25} height={size} aria-hidden="true">
    <rect x="0" y="0" width={W} height="3" rx="0.5" class:on={filled >= 3} />
    <rect x="0" y="4" width={W} height="3" rx="0.5" class:on={filled >= 2} />
    <rect x="0" y="8" width={W} height="3" rx="0.5" class:on={filled >= 1} />
  </svg>
</span>

<style>
  .ev {
    display: inline-flex;
    align-items: center;
    cursor: help;
    line-height: 0;
    /* Same gray as the site's pill text (`.kind`, `.muted`). */
    color: var(--muted);
  }
  /* All bars share one tone via currentColor. Off bars sit at 30% opacity
     so the filled bars carry the whole signal. */
  rect {
    fill: currentColor;
    opacity: 0.3;
  }
  rect.on {
    opacity: 1;
  }
</style>
