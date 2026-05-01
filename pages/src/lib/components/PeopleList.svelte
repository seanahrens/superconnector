<script lang="ts">
  import type { PersonListItem } from '$lib/types';

  interface Props {
    items: PersonListItem[];
    loading: boolean;
    activeId: string | null;
    reorderable: boolean;
    onSelect: (id: string) => void;
    onReorder?: (movedId: string, before: string | null, after: string | null) => void | Promise<void>;
  }
  let { items, loading, activeId, reorderable, onSelect, onReorder }: Props = $props();

  let dragId = $state<string | null>(null);
  let overId = $state<string | null>(null);

  function onDragStart(e: DragEvent, id: string) {
    if (!reorderable) return;
    dragId = id;
    e.dataTransfer?.setData('text/plain', id);
  }
  function onDragOver(e: DragEvent, id: string) {
    if (!reorderable || !dragId || dragId === id) return;
    e.preventDefault();
    overId = id;
  }
  function onDrop(e: DragEvent, id: string) {
    if (!reorderable || !dragId) return;
    e.preventDefault();
    const idxFrom = items.findIndex((p) => p.person_id === dragId);
    const idxTo = items.findIndex((p) => p.person_id === id);
    if (idxFrom === -1 || idxTo === -1 || idxFrom === idxTo) return;
    const reordered = items.slice();
    const [moved] = reordered.splice(idxFrom, 1);
    reordered.splice(idxTo, 0, moved);
    const newIdx = reordered.findIndex((p) => p.person_id === dragId);
    const before = newIdx > 0 ? reordered[newIdx - 1].person_id : null;
    const after = newIdx < reordered.length - 1 ? reordered[newIdx + 1].person_id : null;
    onReorder?.(dragId, before, after);
    dragId = null;
    overId = null;
  }
</script>

<div class="list">
  {#if loading}
    <div class="muted small">loading…</div>
  {:else if items.length === 0}
    <div class="muted small">no people</div>
  {:else}
    {#each items as p (p.person_id)}
      <button
        class="row item"
        class:active={p.person_id === activeId}
        class:over={p.person_id === overId}
        onclick={() => onSelect(p.person_id)}
        draggable={reorderable}
        ondragstart={(e) => onDragStart(e, p.person_id)}
        ondragover={(e) => onDragOver(e, p.person_id)}
        ondrop={(e) => onDrop(e, p.person_id)}
      >
        <div class="col">
          <div class="name">
            {p.display_name ?? p.email ?? '(unknown)'}
          </div>
        </div>
      </button>
    {/each}
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .item {
    width: 100%;
    text-align: left;
    background: white;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 8px 10px;
    cursor: pointer;
  }
  .item:hover { background: var(--hover); }
  .item.active { background: var(--hover); border-color: var(--border); }
  .item.over { outline: 2px dashed var(--accent); }
  .name { font-weight: 500; display: flex; gap: 6px; align-items: center; }
  .badge {
    font-size: 10px;
    padding: 1px 4px;
    background: var(--hover);
    border-radius: 4px;
    color: var(--muted);
    text-transform: uppercase;
  }
</style>
