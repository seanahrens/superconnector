// Granola Personal API client.
// Docs: https://go.granola.ai/api-docs
// Base URL: https://public-api.granola.ai/v1
// Auth: Authorization: Bearer grn_...
//
// List endpoint returns notes without transcripts; fetch each note individually
// with ?include=transcript to get the full transcript.

export interface GranolaOwner {
  name: string | null;
  email: string | null;
}

export interface GranolaNote {
  id: string;
  title: string | null;
  created_at: string;           // ISO 8601 — used as our high-water mark
  summary: string | null;
  transcript: string | null;    // null when fetched from list; populated by getNote()
  owner: GranolaOwner;          // the note creator (the user themselves)
}

interface ListResponse {
  notes: GranolaNote[];
  hasMore: boolean;
  cursor?: string;
}

export interface GranolaListOptions {
  created_after?: string;  // ISO 8601 — only return notes created after this time
  limit?: number;          // max total notes to return (across pages); default 50
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
    return (await resp.json()) as GranolaNote;
  }
}
