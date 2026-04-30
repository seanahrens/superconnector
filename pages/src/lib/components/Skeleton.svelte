<script lang="ts">
  // Shimmer placeholder that reserves layout space while async data loads.
  // Width defaults to 100% of the parent; height is required so callers
  // explicitly pre-allocate space and avoid CLS.

  interface Props {
    h?: string;
    w?: string;
    radius?: string;
  }
  let { h = '16px', w = '100%', radius = '6px' }: Props = $props();
</script>

<div class="skeleton" style="height: {h}; width: {w}; border-radius: {radius}"></div>

<style>
  .skeleton {
    display: block;
    background: linear-gradient(
      90deg,
      var(--hover) 0%,
      var(--border) 50%,
      var(--hover) 100%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s linear infinite;
  }
  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .skeleton { animation: none; opacity: 0.7; }
  }
</style>
