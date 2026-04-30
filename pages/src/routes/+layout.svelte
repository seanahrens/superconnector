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
    <a href="/" class="brand">superconnector</a>
    <nav class="nav">
      {#each navItems as item}
        <a href={item.href} class:active={$page.url.pathname.startsWith(item.href)}>{item.label}</a>
      {/each}
    </nav>
    <span class="spacer"></span>
    <button class="btn" onclick={toggleChat} title="Master chat (⌘K)">
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
    height: 100vh;
  }
  .topbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--border);
    background: white;
  }
  .brand {
    font-weight: 700;
    color: var(--fg);
  }
  .nav {
    display: flex;
    gap: 4px;
  }
  .nav a {
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 6px;
  }
  .nav a:hover { background: var(--hover); text-decoration: none; }
  .nav a.active { color: var(--fg); background: var(--hover); }
  .main {
    overflow: hidden;
    display: flex;
    min-height: 0;
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
</style>
