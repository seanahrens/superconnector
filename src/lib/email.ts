// Cloudflare Email Workers send_email binding. Builds a minimal
// multipart/alternative MIME message (text + HTML) and sends via the binding.
//
// Prereqs (handled by you, in Cloudflare dashboard, once):
//   1. A domain on Cloudflare with Email Routing enabled.
//   2. EMAIL_FROM uses that domain (e.g. daily@yourdomain.com).
//   3. EMAIL_TO is a verified destination address (Cloudflare emails you a
//      one-click verification link the first time you add it to Email Routing).

import type { Env } from '../../worker-configuration';
// `cloudflare:email` is a runtime module; types come from @cloudflare/workers-types.
import { EmailMessage } from 'cloudflare:email';

export interface SendOptions {
  to: string;
  from: string;
  fromName?: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(env: Env, opts: SendOptions): Promise<void> {
  const raw = buildMime(opts);
  const message = new EmailMessage(opts.from, opts.to, raw);
  await env.EMAIL.send(message);
}

function buildMime(opts: SendOptions): string {
  const boundary = `b_${crypto.randomUUID().replace(/-/g, '')}`;
  const messageId = `<${Date.now()}.${crypto.randomUUID()}@superconnector>`;
  const date = new Date().toUTCString();
  const subject = encodeHeader(opts.subject);
  const fromHeader = opts.fromName ? `${encodeHeader(opts.fromName)} <${opts.from}>` : opts.from;

  const headers = [
    `From: ${fromHeader}`,
    `To: ${opts.to}`,
    `Subject: ${subject}`,
    `Message-ID: ${messageId}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const body = [
    `--${boundary}`,
    `Content-Type: text/plain; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    opts.text,
    ``,
    `--${boundary}`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
    ``,
    opts.html,
    ``,
    `--${boundary}--`,
    ``,
  ];
  return [...headers, '', ...body].join('\r\n');
}

function encodeHeader(s: string): string {
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  // RFC 2047 B-encoding for non-ASCII headers.
  const utf8 = new TextEncoder().encode(s);
  let bin = '';
  for (const b of utf8) bin += String.fromCharCode(b);
  return `=?utf-8?B?${btoa(bin)}?=`;
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
