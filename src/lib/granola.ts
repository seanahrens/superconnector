// Minimal Granola API client. The public Granola API surface is small but
// undocumented at the time of writing — endpoints below match the shapes
// observed via their app. Adjust if Granola changes them.

export interface GranolaNote {
  id: string;
  title: string | null;
  recordedAt: string;        // ISO 8601
  summary: string | null;
  transcript: string | null;
  attendees?: Array<{ email?: string | null; name?: string | null }>;
  metadata?: Record<string, unknown>;
}

export interface GranolaListOptions {
  since?: string; // ISO 8601 high-water mark
  limit?: number;
}

export class GranolaClient {
  constructor(
    private apiKey: string,
    private baseUrl: string = 'https://api.granola.so/v1',
  ) {}

  async listNotes(opts: GranolaListOptions = {}): Promise<GranolaNote[]> {
    const url = new URL(`${this.baseUrl}/notes`);
    if (opts.since) url.searchParams.set('since', opts.since);
    if (opts.limit) url.searchParams.set('limit', String(opts.limit));
    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      throw new Error(`Granola listNotes failed: ${resp.status} ${await resp.text()}`);
    }
    const body = (await resp.json()) as { notes?: GranolaNote[] } | GranolaNote[];
    return Array.isArray(body) ? body : (body.notes ?? []);
  }

  async getNote(id: string): Promise<GranolaNote> {
    const resp = await fetch(`${this.baseUrl}/notes/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      throw new Error(`Granola getNote failed: ${resp.status}`);
    }
    return (await resp.json()) as GranolaNote;
  }
}
