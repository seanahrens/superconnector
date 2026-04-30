<script lang="ts">
  // Renders a person's avatar with a graceful fallback chain:
  //   1. avatar_url already on the row (resolved server-side: Gravatar then DiceBear).
  //   2. Lazy-fetch from /api/people/:id/avatar on mount when missing, then cache.
  //   3. Local SVG initial-in-a-circle if everything fails.
  import { api } from '$lib/api';

  interface Props {
    personId: string;
    name?: string | null;
    avatarUrl?: string | null;
    size?: number;
  }
  let { personId, name, avatarUrl, size = 32 }: Props = $props();

  let url = $state<string | null>(avatarUrl ?? null);
  let imgError = $state(false);

  $effect(() => {
    if (!url && personId && !imgError) void resolve();
  });

  async function resolve() {
    try {
      const r = await api.get<{ url: string; source: string }>(`/api/people/${encodeURIComponent(personId)}/avatar`);
      url = r.url;
    } catch {
      imgError = true;
    }
  }

  // Stable per-id color for the local fallback so the same person keeps the
  // same circle tint across renders.
  function hue(seed: string): number {
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return h % 360;
  }
  const initial = $derived(((name ?? '').trim()[0] ?? '?').toUpperCase());
  const bgHue = $derived(hue(personId));
</script>

{#if url && !imgError}
  <img
    class="avatar"
    src={url}
    alt=""
    width={size}
    height={size}
    style="width:{size}px;height:{size}px"
    onerror={() => (imgError = true)}
  />
{:else}
  <span
    class="avatar fallback"
    style="width:{size}px;height:{size}px;font-size:{Math.round(size * 0.42)}px;background:hsl({bgHue} 40% 92%);color:hsl({bgHue} 50% 32%)"
    aria-hidden="true"
  >{initial}</span>
{/if}

<style>
  .avatar {
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    overflow: hidden;
    background: var(--hover);
    object-fit: cover;
  }
  .fallback {
    font-weight: 600;
    line-height: 1;
    user-select: none;
  }
</style>
