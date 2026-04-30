<script lang="ts">
  import { api } from '$lib/api';
  import type { PersonView, TagRow } from '$lib/types';
  import { page } from '$app/stores';
  import PersonProfile from '$components/PersonProfile.svelte';
  import Icon from '$components/Icon.svelte';
  import Skeleton from '$components/Skeleton.svelte';
  import { bumpPeople } from '$lib/stores';

  // The People list / filters / search live in /people/+layout.svelte and
  // persist while you navigate between profiles. This page just renders the
  // selected profile (or its skeleton).

  let view = $state<PersonView | null>(null);
  let allTags = $state<TagRow[]>([]);
  let loadError = $state<string | null>(null);

  $effect(() => {
    const id = $page.params.id;
    if (id) loadProfile(id);
  });
  $effect(() => { loadTags(); });

  async function loadProfile(id: string) {
    view = null;
    loadError = null;
    try {
      view = await api.get<PersonView>(`/api/people/${id}`);
    } catch (err) {
      loadError = (err as Error).message;
    }
  }
  async function loadTags() {
    try {
      const { tags } = await api.get<{ tags: TagRow[] }>(`/api/tags`);
      allTags = tags;
    } catch {
      /* tags are optional */
    }
  }

  async function refreshAll() {
    const id = $page.params.id;
    if (id) await loadProfile(id);
    await loadTags();
    // The sidebar list cares about display_name / tags / meeting_count
    // changes; signal it to refetch.
    bumpPeople();
  }
</script>

<div class="profile-page">
  <a href="/people" class="mobile-back btn small">
    <Icon name="arrow-left" size={14} /> all people
  </a>
  {#if loadError}
    <div class="error">
      <strong>Failed to load.</strong>
      <p>{loadError}</p>
      <p class="muted small">Check the Pages worker secrets and the worker logs.</p>
    </div>
  {:else if view}
    <PersonProfile {view} {allTags} onChanged={refreshAll} />
  {:else}
    <div class="profile-skel">
      <Skeleton h="28px" w="40%" />
      <Skeleton h="14px" w="70%" />
      <Skeleton h="60px" />
      <Skeleton h="120px" />
      <Skeleton h="80px" />
      <Skeleton h="80px" />
    </div>
  {/if}
</div>

<style>
  .profile-page {
    padding: 24px;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .error {
    background: #fff4f4;
    border: 1px solid #f0c0c0;
    border-radius: 8px;
    padding: 16px;
    color: #7a1e1e;
    max-width: 720px;
  }
  .mobile-back { display: none; align-self: flex-start; margin-bottom: 12px; }
  .profile-skel {
    display: flex;
    flex-direction: column;
    gap: 16px;
    max-width: 920px;
    min-height: 520px;
  }

  @media (max-width: 720px) {
    .profile-page { padding: 16px; }
    .mobile-back { display: inline-flex; }
  }
</style>
