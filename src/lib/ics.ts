// Minimal ICS parser. Handles VEVENT, SUMMARY, DTSTART/DTEND (with TZID or Z),
// ATTENDEE (CN, RSVP, mailto), ORGANIZER, and folded lines. Discards alarms,
// timezones (we treat all dts as UTC strings for our windowing math), and
// other VCOMPONENTs we don't care about.

export interface IcsAttendee {
  email: string | null;
  name: string | null;
  rsvp?: 'ACCEPTED' | 'DECLINED' | 'TENTATIVE' | 'NEEDS-ACTION' | null;
}

export interface IcsEvent {
  uid: string;
  summary: string | null;
  start: Date;
  end: Date;
  organizer: IcsAttendee | null;
  attendees: IcsAttendee[];
}

export function parseIcs(text: string): IcsEvent[] {
  const lines = unfoldLines(text);
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> & { attendees: IcsAttendee[] } | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = { attendees: [] };
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current?.uid && current.start && current.end) {
        events.push({
          uid: current.uid,
          summary: current.summary ?? null,
          start: current.start,
          end: current.end,
          organizer: current.organizer ?? null,
          attendees: current.attendees,
        });
      }
      current = null;
      continue;
    }
    if (!current) continue;

    const { name, params, value } = splitProperty(line);
    if (!name) continue;

    switch (name) {
      case 'UID':
        current.uid = value;
        break;
      case 'SUMMARY':
        current.summary = unescapeIcs(value);
        break;
      case 'DTSTART':
        current.start = parseDate(value);
        break;
      case 'DTEND':
        current.end = parseDate(value);
        break;
      case 'ORGANIZER':
        current.organizer = parseAttendee(params, value);
        break;
      case 'ATTENDEE':
        current.attendees.push(parseAttendee(params, value));
        break;
    }
  }
  return events;
}

function unfoldLines(text: string): string[] {
  const raw = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of raw) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      if (out.length > 0) out[out.length - 1] = out[out.length - 1] + line.slice(1);
    } else {
      out.push(line);
    }
  }
  return out;
}

function splitProperty(line: string): {
  name: string | null;
  params: Record<string, string>;
  value: string;
} {
  const colon = line.indexOf(':');
  if (colon < 0) return { name: null, params: {}, value: '' };
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const parts = head.split(';');
  const name = parts[0] ?? '';
  const params: Record<string, string> = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i]!.indexOf('=');
    if (eq > 0) {
      const k = parts[i]!.slice(0, eq).toUpperCase();
      const v = parts[i]!.slice(eq + 1);
      params[k] = stripQuotes(v);
    }
  }
  return { name: name.toUpperCase(), params, value };
}

function stripQuotes(s: string): string {
  return s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

function parseDate(value: string): Date {
  // Forms: 20260429T143000Z, 20260429T143000 (assumed local; treat as UTC),
  // 20260429 (date-only).
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z?))?$/);
  if (!m) return new Date(NaN);
  const [, y, mo, d, hh = '00', mi = '00', ss = '00'] = m;
  const iso = `${y}-${mo}-${d}T${hh}:${mi}:${ss}Z`;
  return new Date(iso);
}

function parseAttendee(params: Record<string, string>, value: string): IcsAttendee {
  const email = value.toLowerCase().startsWith('mailto:') ? value.slice('mailto:'.length) : null;
  const cn = params['CN'] ?? null;
  const rsvp = (params['PARTSTAT'] as IcsAttendee['rsvp']) ?? null;
  return { email, name: cn, rsvp };
}

function unescapeIcs(s: string): string {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

export async function fetchIcs(url: string): Promise<IcsEvent[]> {
  const resp = await fetch(url, { headers: { Accept: 'text/calendar' } });
  if (!resp.ok) throw new Error(`ICS fetch failed: ${resp.status}`);
  return parseIcs(await resp.text());
}

// Find candidate events whose [start, end] overlaps the given timestamp ±windowMinutes.
export function eventsAround(
  events: IcsEvent[],
  at: Date,
  windowMinutes: number = 15,
): IcsEvent[] {
  const ms = windowMinutes * 60 * 1000;
  const t = at.getTime();
  return events.filter((e) => {
    return e.end.getTime() + ms >= t && e.start.getTime() - ms <= t;
  });
}

export function eventsForDay(events: IcsEvent[], day: Date): IcsEvent[] {
  const start = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return events
    .filter((e) => e.start < end && e.end > start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}
