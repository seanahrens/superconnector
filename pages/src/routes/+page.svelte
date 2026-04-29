<script lang="ts">
  // Empty landing → people list.
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';
  onMount(() => goto('/people'));
</script>
