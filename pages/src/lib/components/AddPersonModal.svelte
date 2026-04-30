<script lang="ts">
  // Lightweight modal for "add a person" — single textarea, then submit.
  // On submit, navigates to /people/new?seed=<urlencoded text> which the
  // chat-based new-person page picks up and auto-sends. Keeps the friction
  // of the action down to one tap from the FAB → one input → done.
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  import Icon from './Icon.svelte';

  interface Props {
    onClose: () => void;
  }
  let { onClose }: Props = $props();

  let text = $state('');
  let textareaEl: HTMLTextAreaElement | undefined = $state();

  onMount(() => {
    textareaEl?.focus();
  });

  function submit() {
    const t = text.trim();
    if (!t) return;
    void goto(`/people/new?seed=${encodeURIComponent(t)}`);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      // ⌘+Enter / Ctrl+Enter submits.
      e.preventDefault();
      submit();
    }
  }
</script>

<button class="scrim" onclick={onClose} aria-label="close"></button>
<div class="modal" role="dialog" aria-modal="true" aria-labelledby="addperson-title">
  <header class="hd">
    <h2 id="addperson-title">Add a person</h2>
    <span class="spacer"></span>
    <button class="btn icon-only ghost" onclick={onClose} aria-label="Close">
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
    placeholder="e.g. Hale Guyer, Community Operations at FAR Labs. Self-described superconnector. Offering free office space in exchange for tooling help…"
  ></textarea>
  <div class="actions">
    <span class="muted small kbd-hint">⌘+Enter to submit</span>
    <span class="spacer"></span>
    <button class="btn ghost" onclick={onClose}>Cancel</button>
    <button class="btn btn-primary" onclick={submit} disabled={!text.trim()}>Add person</button>
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
  .kbd-hint { user-select: none; }

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
