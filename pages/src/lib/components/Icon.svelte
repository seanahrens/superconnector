<script lang="ts">
  // Tiny inline-SVG icon set (Lucide-derived: 24x24, 2px stroke, currentColor).
  // Avoids pulling in a font/icon dependency for a handful of glyphs.

  interface Props {
    name:
      | 'users'
      | 'file-text'
      | 'tag'
      | 'list-todo'
      | 'message-square'
      | 'arrow-left'
      | 'plus'
      | 'x'
      | 'search'
      | 'check'
      | 'external-link'
      | 'trash'
      | 'sparkles'
      | 'clock'
      | 'bar-chart-2'
      | 'grip-vertical'
      | 'arrow-down-az'
      | 'merge'
      | 'chevron-down'
      | 'sort'
      | 'filter';
    size?: number;
    strokeWidth?: number;
    'aria-hidden'?: boolean | 'true' | 'false';
  }
  let { name, size = 18, strokeWidth = 2, ...rest }: Props = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden={rest['aria-hidden'] ?? true}
>
  {#if name === 'users'}
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  {:else if name === 'file-text'}
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
    <path d="M16 13H8" />
    <path d="M16 17H8" />
    <path d="M10 9H8" />
  {:else if name === 'tag'}
    <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" />
  {:else if name === 'list-todo'}
    <rect x="3" y="5" width="6" height="6" rx="1" />
    <path d="m3 17 2 2 4-4" />
    <path d="M13 6h8" />
    <path d="M13 12h8" />
    <path d="M13 18h8" />
  {:else if name === 'message-square'}
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  {:else if name === 'arrow-left'}
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  {:else if name === 'plus'}
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  {:else if name === 'x'}
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  {:else if name === 'check'}
    <polyline points="20 6 9 17 4 12" />
  {:else if name === 'external-link'}
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  {:else if name === 'trash'}
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  {:else if name === 'sparkles'}
    <path d="M12 3l1.9 4.6L18 9l-4.6 1.9L12 15l-1.9-4.6L6 9l4.6-1.4z" />
    <path d="M19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
    <path d="M5 17l.7 1.5 1.5.7-1.5.7L5 21l-.7-1.5-1.5-.7 1.5-.7z" />
  {:else if name === 'clock'}
    <circle cx="12" cy="12" r="9" />
    <polyline points="12 7 12 12 15 14" />
  {:else if name === 'bar-chart-2'}
    <line x1="6" y1="20" x2="6" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="18" y1="20" x2="18" y2="14" />
  {:else if name === 'grip-vertical'}
    <circle cx="9" cy="6" r="1" />
    <circle cx="9" cy="12" r="1" />
    <circle cx="9" cy="18" r="1" />
    <circle cx="15" cy="6" r="1" />
    <circle cx="15" cy="12" r="1" />
    <circle cx="15" cy="18" r="1" />
  {:else if name === 'arrow-down-az'}
    <path d="M4 4v16" />
    <polyline points="8 16 4 20 0 16" transform="translate(4 0)" />
    <path d="M14 4h6l-6 6h6" />
    <path d="M14 14h4v6h-4z" />
  {:else if name === 'merge'}
    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M6 10v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-8" />
    <path d="M2 10h20" />
    <path d="M12 10v10" />
  {:else if name === 'chevron-down'}
    <polyline points="6 9 12 15 18 9" />
  {:else if name === 'sort'}
    <path d="M3 6h13" />
    <path d="M3 12h9" />
    <path d="M3 18h5" />
    <path d="M17 4v16" />
    <polyline points="13 16 17 20 21 16" />
  {:else if name === 'filter'}
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
  {/if}
</svg>
