// Daily email: today's meetings briefs + ways-to-help + open followups due
// today. On Sundays, append the weekly digest section.

import type { Env } from '../../worker-configuration';
import { fetchIcs, eventsForDay } from '../lib/ics';
import { briefForPerson, type BriefResult } from '../plays/brief';
import { waysToHelp, type WaysToHelpItem } from '../plays/ways_to_help';
import { buildWeeklyDigest, type WeeklyDigestSection } from '../plays/weekly_digest';
import type { PersonRow, FollowupRow } from '../lib/db';
import { sendEmail, escapeHtml, htmlList } from '../lib/email';
import { jsonCall, cached, MODEL_HAIKU } from '../lib/anthropic';

interface MeetingBrief {
  personId: string | null;
  displayName: string;
  email: string | null;
  start: string;
  end: string;
  brief: BriefResult | null;
  unrecognized: boolean;
}

export async function runDailyEmail(env: Env, now: Date = new Date()): Promise<void> {
  if (!env.EMAIL_TO || !env.EMAIL_FROM) {
    console.log('daily_email skipped — missing EMAIL_TO/EMAIL_FROM');
    return;
  }

  const meetingBriefs = await buildTodayMeetings(env, now);
  const ways = await waysToHelp(env, 5).catch(() => [] as WaysToHelpItem[]);
  const dueToday = await openFollowupsDue(env, now);
  const includeWeekly = now.getUTCDay() === 0; // Sunday
  const weekly = includeWeekly ? await buildWeeklyDigest(env) : null;

  const html = renderHtml({ now, meetingBriefs, ways, dueToday, weekly });
  const text = renderText({ now, meetingBriefs, ways, dueToday, weekly });
  const subjectLine = await subjectFor(env, text, meetingBriefs.length, includeWeekly);

  await sendEmail(env, {
    to: env.EMAIL_TO,
    from: env.EMAIL_FROM,
    fromName: 'SuperConnector',
    subject: subjectLine,
    html,
    text,
  });
}

const SUBJECT_SYSTEM = `You write subject lines for a daily personal-CRM briefing email sent to one user.
Rules:
- Output exactly one short subject line, ≤ 70 characters, no emoji, no quotation marks.
- Lead with the most important content of the day — the one or two key takeaways
  (e.g. who to brief, what to send, what's stale). Use the person's name when one
  meeting clearly dominates.
- Do NOT include the date, the word "superconnector", or a meeting count.
- Use sentence case. No trailing period. No leading prefix like "Daily:".
- If the day is light (no meetings, only routine items), reflect that honestly
  (e.g. "Quiet day — two stale founder followups due"). Don't invent urgency.
Return strict JSON: {"subject": "<line>"}`;

async function subjectFor(
  env: Env,
  text: string,
  meetingCount: number,
  includeWeekly: boolean,
): Promise<string> {
  const fallback = (() => {
    const m = meetingCount === 0 ? 'No meetings' : `${meetingCount} meeting${meetingCount === 1 ? '' : 's'}`;
    return `Daily — ${m}${includeWeekly ? ' + weekly digest' : ''}`;
  })();

  if (!env.ANTHROPIC_API_KEY) return fallback;

  try {
    const result = await jsonCall<{ subject?: string }>(env, {
      model: MODEL_HAIKU,
      systemBlocks: [cached(SUBJECT_SYSTEM)],
      userMessage: `Briefing body:\n\n${text}`,
      maxTokens: 200,
    });
    const raw = (result.subject ?? '').trim();
    if (!raw) return fallback;
    return raw.slice(0, 200);
  } catch (err) {
    console.error('daily_email: subject generation failed', err);
    return fallback;
  }
}

async function buildTodayMeetings(env: Env, now: Date): Promise<MeetingBrief[]> {
  if (!env.PROTON_ICS_URL) return [];
  const events = await fetchIcs(env.PROTON_ICS_URL).catch(() => []);
  const today = eventsForDay(events, now);
  const me = (env.EMAIL_TO ?? '').toLowerCase();

  const out: MeetingBrief[] = [];
  for (const event of today) {
    const others = event.attendees.filter((a) => (a.email ?? '').toLowerCase() !== me);
    const counterpart = others[0] ?? null;
    if (!counterpart || !counterpart.email) {
      out.push({
        personId: null,
        displayName: counterpart?.name ?? event.summary ?? 'unknown',
        email: counterpart?.email ?? null,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        brief: null,
        unrecognized: true,
      });
      continue;
    }
    const person = await env.DB.prepare(
      'SELECT id, display_name FROM people WHERE primary_email = ?1',
    ).bind(counterpart.email.toLowerCase()).first<{ id: string; display_name: string | null }>();
    if (!person) {
      out.push({
        personId: null,
        displayName: counterpart.name ?? counterpart.email,
        email: counterpart.email,
        start: event.start.toISOString(),
        end: event.end.toISOString(),
        brief: null,
        unrecognized: true,
      });
      continue;
    }
    const brief = await briefForPerson(env, person.id).catch(() => null);
    out.push({
      personId: person.id,
      displayName: person.display_name ?? counterpart.name ?? counterpart.email,
      email: counterpart.email,
      start: event.start.toISOString(),
      end: event.end.toISOString(),
      brief,
      unrecognized: false,
    });
  }
  return out;
}

async function openFollowupsDue(env: Env, now: Date): Promise<Array<FollowupRow & { display_name: string | null }>> {
  const today = now.toISOString().slice(0, 10);
  const res = await env.DB.prepare(
    `SELECT f.*, p.display_name FROM followups f
     LEFT JOIN people p ON p.id = f.person_id
     WHERE f.status = 'open' AND f.due_date IS NOT NULL AND f.due_date <= ?1
     ORDER BY f.due_date ASC`,
  ).bind(today).all<FollowupRow & { display_name: string | null }>();
  return res.results ?? [];
}

interface RenderInput {
  now: Date;
  meetingBriefs: MeetingBrief[];
  ways: WaysToHelpItem[];
  dueToday: Array<FollowupRow & { display_name: string | null }>;
  weekly: WeeklyDigestSection | null;
}

function renderHtml(r: RenderInput): string {
  const blocks: string[] = [];
  blocks.push(`<h2>Today — ${r.now.toISOString().slice(0, 10)}</h2>`);

  blocks.push(`<h3>Meetings</h3>`);
  if (r.meetingBriefs.length === 0) {
    blocks.push(`<p><em>No meetings scheduled.</em></p>`);
  } else {
    for (const m of r.meetingBriefs) {
      blocks.push(`<div style="margin-bottom:16px"><strong>${escapeHtml(m.displayName)}</strong>`);
      blocks.push(` <span style="color:#666">${formatTimeRange(m.start, m.end)}</span>`);
      if (m.unrecognized) {
        blocks.push(`<p><em>No record yet — meeting will create one on ingest.</em></p>`);
      } else if (m.brief) {
        blocks.push(`<p>${escapeHtml(m.brief.headline)}</p>`);
        blocks.push(`<p>${escapeHtml(m.brief.recent_context)}</p>`);
        if (m.brief.suggested_questions.length) {
          blocks.push(`<p><em>Suggested questions:</em></p>${htmlList(m.brief.suggested_questions)}`);
        }
        if (m.brief.missing_data_prompts.length) {
          blocks.push(`<p><em>Missing data:</em></p>${htmlList(m.brief.missing_data_prompts)}`);
        }
        if (m.brief.open_followups.length) {
          blocks.push(`<p><em>Open followups:</em></p>${htmlList(m.brief.open_followups)}`);
        }
        if (m.brief.match_opportunities.length) {
          blocks.push(`<p><em>Match opportunities:</em></p>${htmlList(m.brief.match_opportunities)}`);
        }
      }
      blocks.push(`</div>`);
    }
  }

  blocks.push(`<h3>Ways to help your contacts today</h3>`);
  if (r.ways.length === 0) {
    blocks.push(`<p><em>No high-leverage actions surfaced.</em></p>`);
  } else {
    blocks.push(`<ol>`);
    for (const w of r.ways) {
      blocks.push(
        `<li><strong>${escapeHtml(w.headline)}</strong><br>` +
          `<span>${escapeHtml(w.justification)}</span><br>` +
          `<em>${escapeHtml(w.concrete_next_step)}</em></li>`,
      );
    }
    blocks.push(`</ol>`);
  }

  blocks.push(`<h3>Open followups due</h3>`);
  if (r.dueToday.length === 0) {
    blocks.push(`<p><em>None due today.</em></p>`);
  } else {
    blocks.push(htmlList(r.dueToday.map((f) => `${f.display_name ?? ''}: ${f.body}`)));
  }

  if (r.weekly) {
    blocks.push(`<hr><h2>Weekly digest</h2>`);
    blocks.push(`<p><strong>Confirmation queue:</strong> ${r.weekly.pending_classifications} classifications, ` +
      `${r.weekly.pending_person_resolutions} person resolutions, ${r.weekly.pending_extraction_reviews.length} extractions to review.</p>`);
    if (r.weekly.pending_tag_proposals.length) {
      blocks.push(`<p><strong>Tag proposals to review:</strong></p>` +
        htmlList(r.weekly.pending_tag_proposals.map((t) => `${t.name} (${t.category ?? 'free'}) — ${t.example_count} example${t.example_count === 1 ? '' : 's'}`)));
    }
    if (r.weekly.overdue_followups.length) {
      blocks.push(`<p><strong>Overdue followups:</strong></p>` +
        htmlList(r.weekly.overdue_followups.map((f) => `${f.body} (due ${f.due_date})`)));
    }
    if (r.weekly.no_contact_in_60d_active.length) {
      blocks.push(`<p><strong>No contact in 60+ days but tagged active:</strong></p>` +
        htmlList(r.weekly.no_contact_in_60d_active.map((p) => `${p.display_name ?? p.id} — last met ${p.last_met_date ?? '—'}`)));
    }
  }

  return `<!doctype html><html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 720px;">${blocks.join('')}</body></html>`;
}

function renderText(r: RenderInput): string {
  const lines: string[] = [];
  lines.push(`Today — ${r.now.toISOString().slice(0, 10)}`);
  lines.push('');
  lines.push('Meetings:');
  if (r.meetingBriefs.length === 0) lines.push('  (none)');
  for (const m of r.meetingBriefs) {
    lines.push(`- ${m.displayName} ${formatTimeRange(m.start, m.end)}`);
    if (m.brief) {
      lines.push(`    ${m.brief.headline}`);
      for (const q of m.brief.suggested_questions) lines.push(`    Q: ${q}`);
    }
  }
  lines.push('');
  lines.push('Ways to help:');
  if (r.ways.length === 0) lines.push('  (none)');
  for (const w of r.ways) lines.push(`- ${w.headline}\n    ${w.concrete_next_step}`);
  lines.push('');
  lines.push('Followups due:');
  if (r.dueToday.length === 0) lines.push('  (none)');
  for (const f of r.dueToday) lines.push(`- ${f.display_name ?? ''}: ${f.body}`);
  return lines.join('\n');
}

function formatTimeRange(startIso: string, endIso: string): string {
  const fmt = (s: string) => s.slice(11, 16);
  return `${fmt(startIso)}–${fmt(endIso)}`;
}
