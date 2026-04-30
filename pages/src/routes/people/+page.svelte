<script lang="ts">
  // The People list lives in /people/+layout.svelte. This page just renders
  // the empty state on desktop; on mobile the layout hides the right pane
  // entirely so the user sees the list.
</script>

<div class="empty">
  <p class="muted">Pick a person.</p>
</div>

<style>
  .empty {
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
</style>
