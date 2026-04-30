<script lang="ts" generics="T extends string">
  // Modern segmented control. One always-visible row of pills, exactly one
  // is active. Replaces the unusual any/all <select> dropdown on filters.

  interface Option {
    value: T;
    label: string;
  }
  interface Props {
    options: Array<Option>;
    selected: T;
    /** Optional accessible label for the radiogroup. */
    ariaLabel?: string;
  }
  let { options, selected = $bindable(), ariaLabel }: Props = $props();

  function pick(v: T) {
    if (v !== selected) selected = v;
  }
  function onKey(e: KeyboardEvent, idx: number) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const next = options[(idx + 1) % options.length];
      if (next) pick(next.value);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prev = options[(idx - 1 + options.length) % options.length];
      if (prev) pick(prev.value);
    }
  }
</script>

<div class="seg" role="radiogroup" aria-label={ariaLabel ?? 'options'}>
  {#each options as opt, i (opt.value)}
    <button
      type="button"
      class="seg-btn"
      class:active={selected === opt.value}
      role="radio"
      aria-checked={selected === opt.value}
      tabindex={selected === opt.value ? 0 : -1}
      onclick={() => pick(opt.value)}
      onkeydown={(e) => onKey(e, i)}
    >{opt.label}</button>
  {/each}
</div>

<style>
  .seg {
    display: inline-flex;
    background: var(--hover);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2px;
    gap: 0;
  }
  .seg-btn {
    appearance: none;
    border: 0;
    background: transparent;
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 6px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
    line-height: 1.4;
    transition: background 120ms ease, color 120ms ease;
  }
  .seg-btn:hover { color: var(--fg); }
  .seg-btn.active {
    background: var(--accent);
    color: white;
    box-shadow: 0 1px 2px rgba(67,56,202,0.25);
  }
  @media (prefers-reduced-motion: reduce) {
    .seg-btn { transition: none; }
  }
</style>
