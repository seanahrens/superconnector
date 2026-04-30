// Granola Personal API client.
// Docs: https://go.granola.ai/api-docs
// Base URL: https://public-api.granola.ai/v1
// Auth: Authorization: Bearer grn_...
//
// List endpoint returns notes without transcripts; fetch each note individually
// with ?include=transcript to get the full transcript array.

export interface GranolaOwner {
  name: string | null;
  email: string | null;
}

export interface GranolaAttendee {
  name: string | null;
  email: string | null;
  response_status?: string | null;
}

export interface GranolaCalendarEvent {
  id?: string;
  summary?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  attendees?: GranolaAttendee[];
  [key: string]: unknown;
}

export interface GranolaTranscriptTurn {
  text: string;
  start_time?: string;
  end_time?: string;
  speaker?: { source?: string; diarization_label?: string };
}

export interface GranolaNote {
  id: string;
  title: string | null;
  web_url?: string | null;
  owner: GranolaOwner;
  created_at: string;
  updated_at?: string;
  calendar_event: GranolaCalendarEvent | null;
  attendees: GranolaAttendee[];
  // Granola returns summary as TWO fields (always present, no `include` needed):
  //   summary_text — plain text
  //   summary_markdown — markdown formatting (headings, bullets, etc.)
  // We read both. `summary` is a virtual property added at the boundary in
  // getNote() that prefers markdown when populated, else plain text.
  summary_text?: string | null;
  summary_markdown?: string | null;
  summary: string | null;
  // Array of turns when fetched with ?include=transcript; null otherwise.
  transcript: GranolaTranscriptTurn[] | null;
}

interface ListResponse {
  notes: GranolaNote[];
  hasMore: boolean;
  cursor?: string;
}

export interface GranolaListOptions {
  created_after?: string;
  limit?: number;
}

export class GranolaClient {
  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://public-api.granola.ai/v1',
  ) {}

  async listNotes(opts: GranolaListOptions = {}): Promise<GranolaNote[]> {
    const notes: GranolaNote[] = [];
    let cursor: string | undefined;
    const max = opts.limit ?? 50;

    do {
      const url = new URL(`${this.baseUrl}/notes`);
      if (opts.created_after) url.searchParams.set('created_after', opts.created_after);
      if (cursor) url.searchParams.set('cursor', cursor);

      const resp = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' },
      });
      if (!resp.ok) {
        throw new Error(`Granola listNotes failed: ${resp.status} ${await resp.text()}`);
      }
      const body = (await resp.json()) as ListResponse;
      notes.push(...(body.notes ?? []));
      cursor = body.hasMore ? body.cursor : undefined;
    } while (cursor && notes.length < max);

    return notes.slice(0, max);
  }

  async getNote(id: string): Promise<GranolaNote> {
    const resp = await fetch(
      `${this.baseUrl}/notes/${encodeURIComponent(id)}?include=transcript`,
      { headers: { Authorization: `Bearer ${this.apiKey}`, Accept: 'application/json' } },
    );
    if (!resp.ok) {
      throw new Error(`Granola getNote failed: ${resp.status} ${await resp.text()}`);
    }
    const note = (await resp.json()) as GranolaNote;
    // Backfill the virtual `summary` property from whichever real field
    // Granola populated. Prefer markdown when present (richer rendering).
    if (note.summary == null) {
      note.summary = note.summary_markdown ?? note.summary_text ?? null;
    }
    return note;
  }
}

// Fold a transcript array (one entry per spoken turn) into a single string we
// can store in D1 and pass to the extraction LLM. Speaker labels prepended when
// available so the model can see who said what.
export function transcriptToString(
  turns: GranolaTranscriptTurn[] | null | undefined,
): string | null {
  if (!turns || turns.length === 0) return null;
  return turns
    .map((t) => {
      const label = t.speaker?.diarization_label ?? t.speaker?.source ?? '';
      return label ? `[${label}] ${t.text}` : t.text;
    })
    .join('\n');
}

// SHA-256 of (title + summary + transcript) — cheap fingerprint we store with
// each meeting so we can detect when the user has edited a Granola note since
// the last ingest. Returns a hex string.
export async function noteContentHash(note: GranolaNote): Promise<string> {
  const title = note.title ?? '';
  const summary = note.summary ?? '';
  const transcript = transcriptToString(note.transcript) ?? '';
  const blob = `${title}\n${summary}\n${transcript}`;
  const buf = new TextEncoder().encode(blob);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const bytes = new Uint8Array(digest);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

// Returns true when the only attendee is the note owner (i.e. a solo note).
export function isSoloNote(note: GranolaNote, userEmail: string | null): boolean {
  const ownerEmail = (note.owner?.email ?? '').toLowerCase();
  const me = (userEmail ?? '').toLowerCase();
  const others = (note.calendar_event?.attendees ?? note.attendees ?? []).filter((a) => {
    const e = (a.email ?? '').toLowerCase();
    return e && e !== ownerEmail && e !== me;
  });
  return others.length === 0 && !note.calendar_event;
}
