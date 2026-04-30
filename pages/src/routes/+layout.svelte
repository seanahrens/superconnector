<script lang="ts">
  import '../app.css';
  import { page } from '$app/stores';
  import MasterChatDrawer from '$components/MasterChatDrawer.svelte';
  import { onMount } from 'svelte';

  let chatOpen = $state(false);
  let { children } = $props();

  function toggleChat() { chatOpen = !chatOpen; }

  onMount(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggleChat();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const navItems = [
    { href: '/people', label: 'People' },
    { href: '/notes', label: 'Notes' },
    { href: '/tags', label: 'Tags' },
    { href: '/followups', label: 'Followups' },
  ];
</script>

<div class="app">
  <header class="topbar">
    <a href="/" class="brand" aria-label="superconnector home">
      <span class="brand-full">superconnector</span>
      <span class="brand-mark" aria-hidden="true">S</span>
    </a>
    <nav class="nav" aria-label="Primary">
      {#each navItems as item}
        <a href={item.href} class:active={$page.url.pathname.startsWith(item.href)}>{item.label}</a>
      {/each}
    </nav>
    <span class="spacer"></span>
    <button class="btn chat-btn" onclick={toggleChat} title="Master chat (⌘K)" aria-label="Open master chat">
      <span>chat</span>
      <span class="kbd">⌘K</span>
    </button>
  </header>

  <main class="main">
    {@render children()}
  </main>

  <MasterChatDrawer bind:open={chatOpen} />
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: auto 1fr;
    height: 100dvh; /* dvh accounts for mobile browser chrome */
    padding-top: var(--safe-top);
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: white;
    /* Don't let nav links push the chat button off the page. */
    min-height: 48px;
  }
  .brand {
    font-weight: 700;
    color: var(--fg);
    flex-shrink: 0;
  }
  .brand-mark { display: none; }

  .nav {
    display: flex;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
    /* Allow horizontal scroll without showing a scrollbar; also let the
       last child show fully on mobile with a tiny right padding. */
    padding-right: 4px;
  }
  .nav::-webkit-scrollbar { display: none; }
  .nav a {
    color: var(--muted);
    padding: 8px 12px;
    border-radius: 6px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .nav a:hover { background: var(--hover); text-decoration: none; }
  .nav a.active { color: var(--fg); background: var(--hover); }

  .main {
    overflow: hidden;
    display: flex;
    min-height: 0;
  }
  .chat-btn {
    flex-shrink: 0;
  }
  .kbd {
    display: inline-block;
    padding: 0 4px;
    background: var(--hover);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 11px;
    color: var(--muted);
  }

  @media (max-width: 720px) {
    .topbar {
      gap: 8px;
      padding: 6px 12px;
    }
    .brand-full { display: none; }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border-radius: 50%;
      background: var(--accent);
      color: white;
      font-size: 14px;
      font-weight: 600;
    }
    .nav { flex: 1; }
    .nav a { padding: 8px 10px; }
    /* The keyboard hint isn't useful on touch. */
    .kbd { display: none; }
    .chat-btn { padding: 8px 12px; }
  }
</style>
