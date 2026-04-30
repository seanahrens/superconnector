<script lang="ts">
  // Inline click-to-edit. Click the value (or the placeholder when empty) to
  // enter edit mode. Enter saves on single-line; ⌘+Enter saves on multiline.
  // Escape cancels. Blur saves to mimic standard inline-edit expectations.
  import Icon from './Icon.svelte';

  interface Props {
    value: string | null;
    placeholder?: string;
    onSave: (next: string) => void | Promise<void>;
    /** Override the rendered presentation (e.g. linkified email). */
    display?: string;
    label?: string;
    type?: 'text' | 'email' | 'tel';
    multiline?: boolean;
  }
  let {
    value,
    placeholder = 'click to edit',
    onSave,
    display,
    label = 'Edit',
    type = 'text',
    multiline = false,
  }: Props = $props();

  let editing = $state(false);
  let draft = $state('');
  let saving = $state(false);
  let inputEl: HTMLInputElement | HTMLTextAreaElement | undefined = $state();

  function start() {
    draft = value ?? '';
    editing = true;
    queueMicrotask(() => {
      const el = inputEl;
      if (!el) return;
      if (typeof (el as HTMLInputElement).select === 'function') {
        (el as HTMLInputElement).select();
      } else {
        el.focus();
      }
    });
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
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (multiline ? (e.metaKey || e.ctrlKey) : !e.shiftKey)) {
      e.preventDefault();
      void commit();
    }
  }
</script>

{#if editing}
  <span class="wrap editing" class:multi={multiline}>
    {#if multiline}
      <textarea
        bind:value={draft}
        bind:this={inputEl}
        onkeydown={onKey}
        onblur={commit}
        {placeholder}
        disabled={saving}
        rows="3"
      ></textarea>
    {:else}
      <input
        bind:value={draft}
        bind:this={inputEl}
        onkeydown={onKey}
        onblur={commit}
        {type}
        {placeholder}
        disabled={saving}
      />
    {/if}
  </span>
{:else}
  <span class="wrap">
    <button class="value as-text" class:placeholder={!value && !display} onclick={start} aria-label={label}>
      {display ?? value ?? placeholder}
    </button>
    <button class="pencil" onclick={start} aria-label={label} title={label}>
      <Icon name="pencil" size={12} />
    </button>
  </span>
{/if}

<style>
  .wrap { display: inline-flex; align-items: center; gap: 4px; vertical-align: baseline; }
  .wrap.editing input,
  .wrap.editing textarea {
    font: inherit;
    color: inherit;
    background: white;
    border: 1px solid var(--accent);
    border-radius: 6px;
    padding: 2px 6px;
    min-width: 220px;
  }
  .wrap.editing.multi {
    display: flex;
    width: 100%;
  }
  .wrap.editing.multi textarea {
    width: 100%;
    line-height: 1.5;
    padding: 6px 8px;
    resize: vertical;
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
  .value.placeholder { color: var(--muted); cursor: pointer; }
  .value.as-text:hover { background: var(--hover); border-radius: 4px; box-shadow: 0 0 0 4px var(--hover); }
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
