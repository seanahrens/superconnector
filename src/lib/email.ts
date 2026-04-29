// Resend client + tiny HTML rendering helpers.

import type { Env } from '../../worker-configuration';

export interface SendOptions {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(env: Env, opts: SendOptions): Promise<void> {
  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: opts.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });
  if (!resp.ok) {
    throw new Error(`resend send failed: ${resp.status} ${await resp.text()}`);
  }
}

export function escapeHtml(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function htmlList(items: string[]): string {
  if (items.length === 0) return '';
  return `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}
