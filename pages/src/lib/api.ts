// Tiny fetch wrapper around the Worker API. Calls go to the same-origin
// SvelteKit proxy at /api/*, which attaches the bearer token server-side
// (see pages/src/routes/api/[...path]/+server.ts). The browser never sees
// the API token; the page itself is gated by hooks.server.ts (basic auth).

const BASE = '';

function headers(json = true): HeadersInit {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  return h;
}

async function handle<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text();
    // Try to surface a structured server message; fall back to raw text.
    let detail = text;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.error === 'string') detail = parsed.error;
    } catch {
      /* not JSON */
    }
    const err = new Error(`API ${resp.status}: ${detail}`);
    console.error(err);
    throw err;
  }
  return (await resp.json()) as T;
}

export const api = {
  base: BASE,

  get<T>(path: string): Promise<T> {
    return fetch(`${BASE}${path}`, { headers: headers(false) }).then(handle<T>);
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(handle<T>);
  },
  patch<T>(path: string, body?: unknown): Promise<T> {
    return fetch(`${BASE}${path}`, {
      method: 'PATCH',
      headers: headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }).then(handle<T>);
  },
  delete<T>(path: string): Promise<T> {
    return fetch(`${BASE}${path}`, {
      method: 'DELETE',
      headers: headers(false),
    }).then(handle<T>);
  },

  // Streaming chat — returns a parsed event stream.
  async *chatStream(threadId: string, content: string, scope: 'global' | 'person', personId?: string) {
    const resp = await fetch(`${BASE}/api/chat/threads/${threadId}/messages`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ content, scope, person_id: personId }),
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`chat stream failed: ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop() ?? '';
      for (const e of events) {
        const line = e.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          yield JSON.parse(line.slice(6)) as ChatEvent;
        } catch {
          // ignore malformed event
        }
      }
    }
  },
};

export type ChatEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string; id: string; write?: boolean }
  | { type: 'tool_result'; name: string; id: string; write?: boolean }
  | { type: 'tool_error'; name: string; id: string; error: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
