<script lang="ts">
  // Inline click-to-edit. Renders the value as text; clicking the pencil
  // (or the value, when prop `clickToEdit` is true) swaps in an input
  // field. Enter saves; Escape cancels. Blur saves to mimic standard text
  // editor expectations.
  import Icon from './Icon.svelte';

  interface Props {
    value: string | null;
    placeholder?: string;
    /** Async setter; should write to backend and resolve when done. */
    onSave: (next: string) => void | Promise<void>;
    /** Override the rendered presentation (e.g. mailto link). */
    display?: string;
    /** When true, a click on the value itself enters edit mode (in
        addition to the explicit pencil button). */
    clickToEdit?: boolean;
    /** ARIA label for the pencil button. */
    label?: string;
    type?: 'text' | 'email' | 'tel';
  }
  let {
    value,
    placeholder = 'click to edit',
    onSave,
    display,
    clickToEdit = false,
    label = 'Edit',
    type = 'text',
  }: Props = $props();

  let editing = $state(false);
  let draft = $state('');
  let saving = $state(false);
  let inputEl: HTMLInputElement | undefined = $state();

  function start() {
    draft = value ?? '';
    editing = true;
    queueMicrotask(() => inputEl?.select());
  }

  async function commit() {
    if (saving) return;
    const next = draft.trim();
    if (next === (value ?? '')) {
      editing = false;
      return;
    }
    saving = true;
    try {
      await onSave(next);
      editing = false;
    } finally {
      saving = false;
    }
  }

  function cancel() {
    if (saving) return;
    editing = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      void commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }
</script>

{#if editing}
  <span class="wrap editing">
    <input
      bind:value={draft}
      bind:this={inputEl}
      onkeydown={onKey}
      onblur={commit}
      {type}
      {placeholder}
      disabled={saving}
    />
  </span>
{:else}
  <span class="wrap">
    {#if clickToEdit}
      <button class="value as-text" onclick={start}>{display ?? value ?? placeholder}</button>
    {:else if display}
      <span class="value">{display}</span>
    {:else}
      <span class="value" class:muted={!value}>{value ?? placeholder}</span>
    {/if}
    <button class="pencil" onclick={start} aria-label={label} title={label}>
      <Icon name="pencil" size={12} />
    </button>
  </span>
{/if}

<style>
  .wrap { display: inline-flex; align-items: center; gap: 4px; }
  .wrap.editing input {
    font: inherit;
    color: inherit;
    background: white;
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 2px 6px;
    min-width: 220px;
  }
  .value.as-text {
    background: none;
    border: 0;
    padding: 0;
    color: inherit;
    font: inherit;
    cursor: text;
    text-align: left;
  }
  .value.as-text:hover { background: var(--hover); border-radius: 4px; box-shadow: 0 0 0 4px var(--hover); }
  .value.muted { color: var(--muted); }
  .pencil {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border-radius: 4px;
    border: 0;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
    opacity: 0;
    transition: opacity 120ms ease;
  }
  .wrap:hover .pencil { opacity: 1; }
  .pencil:focus-visible { opacity: 1; outline: 2px solid var(--accent); }
  .pencil:hover { background: var(--hover); color: var(--fg); }
</style>
