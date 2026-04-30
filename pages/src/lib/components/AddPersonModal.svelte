<script lang="ts">
  // Single-textarea modal that creates a person inline. Submitting kicks
  // off a 'new-person' chat stream in the background; the modal stays
  // open with a disabled "Adding…" button until the person_created event
  // fires, then closes and navigates to /people/<id>.
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import { api } from '$lib/api';
  import { ulid } from '$lib/ulid';
  import { bumpPeople } from '$lib/stores';
  import Icon from './Icon.svelte';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let text = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  let submitting = $state(false);
  let error = $state<string | null>(null);
  let progress = $state<string>(''); // small status line ("Creating…" → "Capturing details…")

  onMount(() => {
    textareaEl?.focus();
  });

  async function submit() {
    const t = text.trim();
    if (!t || submitting) return;
    submitting = true;
    error = null;
    progress = 'Creating record…';
    let createdId: string | null = null;
    try {
      const threadId = ulid();
      for await (const ev of api.chatStream(threadId, t, 'new-person')) {
        if (ev.type === 'tool_use') {
          if (ev.name === 'add_person') progress = 'Creating record…';
          else if (ev.name === 'dictate') progress = 'Capturing details…';
        } else if (ev.type === 'person_created') {
          createdId = ev.id;
          // Don't break — let dictate run too. We'll redirect when done.
        } else if (ev.type === 'error') {
          throw new Error(ev.message);
        } else if (ev.type === 'done') {
          break;
        }
      }
      if (!createdId) {
        throw new Error('No person was created. Try giving more identifying info.');
      }
      bumpPeople();
      onClose();
      void goto(`/people/${createdId}`);
    } catch (err) {
      error = (err as Error).message;
      progress = '';
    } finally {
      submitting = false;
    }
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape' && !submitting) {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  }

  function maybeClose() {
    if (!submitting) onClose();
  }
</script>

<button class="scrim" onclick={maybeClose} aria-label="close"></button>
<div class="modal" role="dialog" aria-modal="true" aria-labelledby="addperson-title">
  <header class="hd">
    <h2 id="addperson-title">Add a person</h2>
    <span class="spacer"></span>
    <button class="btn icon-only ghost" onclick={maybeClose} aria-label="Close" disabled={submitting}>
      <Icon name="x" size={16} />
    </button>
  </header>
  <p class="muted small">
    Describe them in your own words. Name, email, what they do, what they
    need, what they offer — whatever you have.
  </p>
  <textarea
    bind:value={text}
    bind:this={textareaEl}
    onkeydown={onKey}
    rows="6"
    placeholder="e.g. Jane Doe, founder at Acme. Based in Berlin. Raising a seed round. Looking for a technical cofounder."
    disabled={submitting}
  ></textarea>

  {#if error}<div class="error">{error}</div>{/if}

  <div class="actions">
    {#if submitting}
      <span class="muted small status">{progress}</span>
    {:else}
      <span class="muted small kbd-hint">⌘+Enter to submit</span>
    {/if}
    <span class="spacer"></span>
    <button class="btn ghost" onclick={onClose} disabled={submitting}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={submitting || !text.trim()}>
      {#if submitting}
        <span class="spinner" aria-hidden="true"></span>
        Adding…
      {:else}
        Add person
      {/if}
    </button>
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
    inset: 12vh 50% auto 50%;
    transform: translateX(-50%);
    width: min(560px, 96vw);
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 12px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.18);
    padding: 18px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .hd { display: flex; align-items: center; gap: 8px; }
  .hd h2 { margin: 0; font-size: 16px; }
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 140px;
    line-height: 1.5;
    background: white;
  }
  .actions { display: flex; align-items: center; gap: 8px; }
  .kbd-hint, .status { user-select: none; }
  .status { color: var(--accent); font-weight: 500; }

  .error {
    color: #7a1e1e;
    background: #fff4f4;
    border: 1px solid #f0c0c0;
    border-radius: 6px;
    padding: 8px;
    font-size: 13px;
  }

  .spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 0.7s linear infinite;
    margin-right: 6px;
    vertical-align: -2px;
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .spinner { animation-duration: 1.6s; }
  }

  @media (max-width: 720px) {
    .modal {
      inset: 0;
      transform: none;
      width: 100vw;
      max-height: 100vh;
      border-radius: 0;
      padding: 16px;
    }
    .kbd-hint { display: none; }
  }
</style>
