<script lang="ts">
  // Quick-action row on a person's profile: one button per channel the
  // person has data for. Email always uses mailto:, phone-bearing rows
  // get sms: (which Apple devices route to iMessage when both ends are
  // iMessage users) and signal: (signal.me/#p/<phone>) links.

  interface Props {
    email?: string | null;
    phone?: string | null;
    /** Pre-filled subject for mailto. */
    subject?: string | null;
  }
  let { email, phone, subject }: Props = $props();

  function toE164(raw: string): string | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    const startsPlus = trimmed.startsWith('+');
    const digits = trimmed.replace(/[^\d]/g, '');
    if (!digits) return null;
    if (startsPlus) return `+${digits}`;
    if (digits.length === 10) return `+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
    return `+${digits}`;
  }
  const e164 = $derived(phone ? toE164(phone) : null);

  const mailHref = $derived.by(() => {
    if (!email) return null;
    const params = subject ? `?subject=${encodeURIComponent(subject)}` : '';
    return `mailto:${email}${params}`;
  });
  const smsHref = $derived(e164 ? `sms:${e164}` : null);
  const signalHref = $derived(e164 ? `https://signal.me/#p/${e164}` : null);
</script>

{#if mailHref || smsHref || signalHref}
  <div class="row">
    {#if mailHref}
      <a class="btn small" href={mailHref}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
          <polyline points="22,6 12,13 2,6" />
        </svg>
        Email
      </a>
    {/if}
    {#if smsHref}
      <a class="btn small" href={smsHref}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Message
      </a>
    {/if}
    {#if signalHref}
      <a class="btn small" href={signalHref} target="_blank" rel="noopener">
        <!-- Simple chat-bubble glyph; Signal's brand is a wordmark we don't ship. -->
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M7 14c1 1.5 3 2.5 5 2.5s4-1 5-2.5" />
        </svg>
        Signal
      </a>
    {/if}
  </div>
{/if}

<style>
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .btn { text-decoration: none; }
</style>
