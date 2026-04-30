// /api/notes/:granolaNoteId — full Granola note content (summary + folded
// transcript) for the Notes detail pane. Reads from `meetings` if we've
// already ingested it; falls through to a live Granola fetch otherwise so
// queue items (which only stash a 1500-char transcript preview) render
// the full body once the detail pane opens.

import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import { GranolaClient, transcriptToString } from '../lib/granola';

const app = new Hono<{ Bindings: Env }>();

app.get('/:noteId', async (c) => {
  const noteId = c.req.param('noteId');

  // Already-ingested case — use what we have on disk.
  const meeting = await c.env.DB.prepare(
    `SELECT id, summary, transcript, source_ref FROM meetings
      WHERE source = 'granola' AND source_ref = ?1 LIMIT 1`,
  ).bind(noteId).first<{ id: string; summary: string | null; transcript: string | null; source_ref: string }>();

  if (meeting) {
    // Even when ingested, the older rows may have a null summary because we
    // were reading the wrong field name (`summary` vs `summary_text` /
    // `summary_markdown`). If summary is empty, fetch fresh from Granola.
    if (meeting.summary && meeting.transcript) {
      return c.json({ summary: meeting.summary, transcript: meeting.transcript, source: 'meetings' });
    }
    if (!c.env.GRANOLA_API_KEY) {
      return c.json({ summary: meeting.summary, transcript: meeting.transcript, source: 'meetings' });
    }
    try {
      const granola = new GranolaClient(c.env.GRANOLA_API_KEY);
      const note = await granola.getNote(noteId);
      return c.json({
        summary: note.summary,
        transcript: transcriptToString(note.transcript),
        source: 'granola_refetch',
      });
    } catch (err) {
      // Fall back to whatever we had locally if the refetch fails.
      return c.json({ summary: meeting.summary, transcript: meeting.transcript, source: 'meetings' });
    }
  }

  // Not ingested → fetch from Granola.
  if (!c.env.GRANOLA_API_KEY) return c.json({ error: 'GRANOLA_API_KEY not set' }, 500);
  try {
    const granola = new GranolaClient(c.env.GRANOLA_API_KEY);
    const note = await granola.getNote(noteId);
    return c.json({
      summary: note.summary,
      transcript: transcriptToString(note.transcript),
      source: 'granola',
    });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

export default app;
