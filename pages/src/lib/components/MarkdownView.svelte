<script lang="ts">
  // Tiny inline markdown renderer for chat messages. Handles **bold**, *italic*,
  // `code`, [text](url), paragraph breaks, and intra-paragraph line breaks.
  // No npm dep. Sanitizes URLs (only http(s), mailto, and same-origin paths
  // are clickable) and HTML-escapes everything else before parsing the few
  // patterns we care about.
  //
  // Internal links (paths starting with "/") are intercepted on click so
  // SvelteKit handles the navigation client-side.
  import { goto } from '$app/navigation';

  interface Props {
    text: string;
  }
  let { text }: Props = $props();

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeUrl(href: string): string | null {
    if (!href) return null;
    if (href.startsWith('/') && !href.startsWith('//')) return href;
    try {
      const u = new URL(href);
      if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') {
        return href;
      }
    } catch {
      /* not a URL */
    }
    return null;
  }

  // Order matters: code first (since backtick contents are literal), then
  // links, then bold (**), then italic (*).
  function renderInline(s: string): string {
    let out = escapeHtml(s);
    out = out.replace(/`([^`\n]+)`/g, (_, t) => `<code>${t}</code>`);
    out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, txt: string, url: string) => {
      const safe = safeUrl(url);
      if (!safe) return txt;
      const isInternal = safe.startsWith('/');
      const attrs = isInternal
        ? `href="${safe}" data-internal="1"`
        : `href="${safe}" target="_blank" rel="noopener"`;
      return `<a ${attrs}>${txt}</a>`;
    });
    out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return out;
  }

  const html = $derived.by(() => {
    if (!text) return '';
    // Split into paragraphs on blank lines; preserve single newlines as <br>.
    return text
      .split(/\n{2,}/)
      .map((para) => `<p>${para.split('\n').map(renderInline).join('<br>')}</p>`)
      .join('');
  });

  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest('a');
    if (!a) return;
    if (!a.hasAttribute('data-internal')) return;
    const href = a.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    void goto(href);
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="md" role="presentation" onclick={onClick}>{@html html}</div>

<style>
  .md :global(p) { margin: 0 0 8px; }
  .md :global(p:last-child) { margin-bottom: 0; }
  .md :global(code) {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: var(--hover);
    padding: 1px 4px;
    border-radius: 3px;
    font-size: 0.9em;
  }
  .md :global(a) { color: var(--accent); }
  .md :global(a:hover) { color: var(--accent-hover); }
  .md :global(strong) { font-weight: 600; }
</style>
