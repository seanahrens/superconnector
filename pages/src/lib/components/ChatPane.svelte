<script lang="ts">
  import { api } from '$lib/api';
  import type { ChatMessage } from '$lib/types';
  import MarkdownView from './MarkdownView.svelte';

  interface Props {
    scope: 'global' | 'person' | 'new-person';
    threadId: string;
    personId?: string;
    initialInput?: string;
    /** When true, treat initialInput as "submit on arrival" rather than
        "prefill the field and wait for the user to press send". */
    autoSend?: boolean;
    onWrite?: (toolName: string) => void | Promise<void>;
    /** Fired when scope='new-person' and add_person resolves a new id. */
    onPersonCreated?: (id: string) => void;
  }
  let { scope, threadId, personId, initialInput, autoSend, onWrite, onPersonCreated }: Props = $props();

  let messages = $state<Array<{ role: 'user' | 'assistant'; text: string; toolCalls?: string[] }>>([]);
  let input = $state('');
  let sending = $state(false);
  let scroller: HTMLDivElement | undefined = $state();

  $effect(() => {
    void threadId;
    loadHistory();
  });

  // Per-person ChatPane reacts to the global "focus the person chat"
  // shortcut (`C` from the layout's keydown handler) by focusing its
  // textarea. Master-chat is opened via ⌘K which already focuses there.
  $effect(() => {
    if (scope !== 'person') return;
    function onFocusEvent() {
      textareaEl?.focus();
    }
    window.addEventListener('superconnector:focus-person-chat', onFocusEvent);
    return () => window.removeEventListener('superconnector:focus-person-chat', onFocusEvent);
  });

  // Apply initialInput ONCE per distinct seed value. Without this guard the
  // effect re-fires every time the user clears the textarea (or send empties
  // it), re-populating the field and fighting the user. When autoSend is on,
  // submit immediately instead of leaving the field for the user to send.
  let lastSeed = $state<string | undefined>(undefined);
  $effect(() => {
    if (initialInput && initialInput !== lastSeed) {
      input = initialInput;
      lastSeed = initialInput;
      if (autoSend) {
        // Run on the next tick so any pending state mutations settle first.
        queueMicrotask(() => { void send(); });
      }
    }
  });

  async function loadHistory() {
    messages = [];
    try {
      const { messages: ms } = await api.get<{ messages: ChatMessage[] }>(`/api/chat/threads/${threadId}`);
      const out: typeof messages = [];
      for (const m of ms) {
        if (m.role === 'user' && m.content) out.push({ role: 'user', text: m.content });
        else if (m.role === 'assistant' && m.content) out.push({ role: 'assistant', text: m.content });
      }
      messages = out;
    } catch {
      // brand new thread; ignore.
    }
  }

  async function send() {
    if (!input.trim() || sending) return;
    sending = true;
    const userText = input.trim();
    input = '';
    messages = [...messages, { role: 'user', text: userText }, { role: 'assistant', text: '', toolCalls: [] }];
    scrollDown();

    try {
      for await (const ev of api.chatStream(threadId, userText, scope, personId)) {
        const last = messages[messages.length - 1];
        if (!last || last.role !== 'assistant') continue;
        if (ev.type === 'text') {
          last.text = (last.text ? last.text + '\n' : '') + ev.text;
          messages = [...messages];
        } else if (ev.type === 'tool_use') {
          last.toolCalls = [...(last.toolCalls ?? []), `→ ${ev.name}`];
          messages = [...messages];
        } else if (ev.type === 'tool_result') {
          last.toolCalls = [...(last.toolCalls ?? []), `✓ ${ev.name}`];
          messages = [...messages];
          if (ev.write && onWrite) {
            try { await onWrite(ev.name); } catch { /* swallow refetch errors */ }
          }
        } else if (ev.type === 'tool_error') {
          last.toolCalls = [...(last.toolCalls ?? []), `✗ ${ev.name}: ${ev.error}`];
          messages = [...messages];
        } else if (ev.type === 'person_created') {
          if (onPersonCreated) {
            try { onPersonCreated(ev.id); } catch { /* ignore */ }
          }
        }
        scrollDown();
      }
    } catch (err) {
      const last = messages[messages.length - 1];
      if (last) last.text = `Error: ${(err as Error).message}`;
      messages = [...messages];
    } finally {
      sending = false;
    }
  }

  function scrollDown() {
    queueMicrotask(() => {
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  }

  // Autoresize: textarea starts at one line, grows up to MAX_LINES
  // (~3 lines), then becomes scrollable. Recompute on input + when input
  // is reset programmatically (after send).
  let textareaEl: HTMLTextAreaElement | undefined = $state();
  const MAX_LINES = 3;
  function autosize() {
    if (!textareaEl) return;
    textareaEl.style.height = 'auto';
    const lineHeight = parseFloat(getComputedStyle(textareaEl).lineHeight || '20');
    const padTop = parseFloat(getComputedStyle(textareaEl).paddingTop || '0');
    const padBot = parseFloat(getComputedStyle(textareaEl).paddingBottom || '0');
    const maxH = Math.round(lineHeight * MAX_LINES + padTop + padBot);
    const scrollH = textareaEl.scrollHeight;
    const next = Math.min(scrollH, maxH);
    textareaEl.style.height = `${next}px`;
    textareaEl.style.overflowY = scrollH > maxH ? 'auto' : 'hidden';
  }
  $effect(() => { void input; autosize(); });
</script>

<div class="pane">
  <div class="msgs" bind:this={scroller}>
    {#if messages.length === 0}
      <p class="empty">No messages yet.</p>
    {/if}
    {#each messages as m}
      <div class="msg" class:user={m.role === 'user'} class:assistant={m.role === 'assistant'}>
        {#if m.toolCalls && m.toolCalls.length}
          <div class="tools">
            {#each m.toolCalls as t}<span class="tool">{t}</span>{/each}
          </div>
        {/if}
        {#if m.role === 'assistant'}
          <div class="text"><MarkdownView text={m.text} /></div>
        {:else}
          <div class="text">{m.text}</div>
        {/if}
      </div>
    {/each}
  </div>
  <div class="composer">
    <textarea
      bind:value={input}
      bind:this={textareaEl}
      onkeydown={onKey}
      oninput={autosize}
      placeholder={scope === 'person' ? 'Update or ask about this person…' : 'Ask anything…'}
      rows="1"
      disabled={sending}
    ></textarea>
    <button class="btn btn-primary" onclick={send} disabled={sending || !input.trim()}>
      {sending ? '…' : 'send'}
    </button>
  </div>
</div>

<style>
  .pane {
    display: grid;
    grid-template-rows: 1fr auto;
    height: 100%;
    min-height: 0;
  }
  .msgs {
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .empty { color: var(--muted); }
  .msg.user { align-self: flex-end; max-width: 85%; }
  .msg.assistant { align-self: flex-start; max-width: 95%; }
  .msg .text {
    padding: 8px 12px;
    border-radius: 8px;
    background: white;
    border: 1px solid var(--border);
    white-space: pre-wrap;
  }
  .msg.user .text {
    background: #e5e7eb;
    color: #111;
    border-color: #d1d5db;
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 4px;
  }
  .tool {
    font-size: 11px;
    color: var(--muted);
    background: var(--hover);
    padding: 1px 6px;
    border-radius: 4px;
  }
  .composer {
    display: flex;
    gap: 8px;
    padding: 8px;
    border-top: 1px solid var(--border);
    background: white;
  }
  .composer textarea {
    flex: 1;
    resize: none;
  }
</style>
