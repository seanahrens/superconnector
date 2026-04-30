// Chat API: persistent threads + SSE streaming responses with tool use.
// One endpoint serves master ('global') and per-person ('person') scopes.

import { Hono } from 'hono';
import type { Env } from '../../worker-configuration';
import type { ChatThreadRow, ChatMessageRow } from '../lib/db';
import { ulid, nowIso } from '../lib/ulid';
import { getClient, MODEL_SONNET, cached } from '../lib/anthropic';
import { anthropicToolDefs, runTool, isWriteTool } from '../tools';
import { loadPersonView, summarizePersonForPrompt } from '../lib/person_view';
import type Anthropic from '@anthropic-ai/sdk';

const app = new Hono<{ Bindings: Env }>();

// List threads for the sidebar.
app.get('/threads', async (c) => {
  const url = new URL(c.req.url);
  const scope = url.searchParams.get('scope');
  const personId = url.searchParams.get('person_id');
  let stmt: D1PreparedStatement;
  if (scope === 'person' && personId) {
    stmt = c.env.DB.prepare(
      `SELECT * FROM chat_threads WHERE scope = 'person' AND person_id = ?1 ORDER BY updated_at DESC LIMIT 50`,
    ).bind(personId);
  } else if (scope === 'global') {
    stmt = c.env.DB.prepare(
      `SELECT * FROM chat_threads WHERE scope = 'global' ORDER BY updated_at DESC LIMIT 50`,
    );
  } else {
    stmt = c.env.DB.prepare(`SELECT * FROM chat_threads ORDER BY updated_at DESC LIMIT 50`);
  }
  const rows = await stmt.all<ChatThreadRow>();
  return c.json({ threads: rows.results ?? [] });
});

// Fetch one thread with messages.
app.get('/threads/:id', async (c) => {
  const id = c.req.param('id');
  const thread = await c.env.DB.prepare('SELECT * FROM chat_threads WHERE id = ?1').bind(id).first<ChatThreadRow>();
  if (!thread) return c.json({ error: 'not found' }, 404);
  const msgs = await c.env.DB.prepare(
    'SELECT * FROM chat_messages WHERE thread_id = ?1 ORDER BY created_at',
  ).bind(id).all<ChatMessageRow>();
  return c.json({ thread, messages: msgs.results ?? [] });
});

app.delete('/threads/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM chat_threads WHERE id = ?1').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// Send a message; stream the assistant response as SSE.
app.post('/threads/:id/messages', async (c) => {
  const threadId = c.req.param('id');
  const body = await c.req.json<{ content: string; scope?: 'global' | 'person'; person_id?: string }>();

  // Load or create thread.
  let thread = await c.env.DB.prepare('SELECT * FROM chat_threads WHERE id = ?1').bind(threadId).first<ChatThreadRow>();
  if (!thread) {
    const now = nowIso();
    thread = {
      id: threadId,
      scope: body.scope ?? 'global',
      person_id: body.person_id ?? null,
      title: body.content.slice(0, 60),
      created_at: now,
      updated_at: now,
    };
    await c.env.DB.prepare(
      `INSERT INTO chat_threads (id, scope, person_id, title, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
    ).bind(thread.id, thread.scope, thread.person_id, thread.title, thread.created_at, thread.updated_at).run();
  }

  // Persist user message immediately.
  const userMsgId = ulid();
  const now = nowIso();
  await c.env.DB.prepare(
    `INSERT INTO chat_messages (id, thread_id, role, content, tool_calls, created_at)
     VALUES (?1, ?2, 'user', ?3, NULL, ?4)`,
  ).bind(userMsgId, thread.id, body.content, now).run();

  // Build system prompt.
  const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [
    cached(SYSTEM_BASE),
  ];
  if (thread.scope === 'person' && thread.person_id) {
    const view = await loadPersonView(c.env, thread.person_id);
    if (view) {
      systemBlocks.push({
        type: 'text',
        text: `You are operating in the context of ONE person:\n\n${summarizePersonForPrompt(view)}\n\nWhen the user asks something about "they/them/her/him" without naming, default to this person. When using tools that take person_id, use ${view.person.id} unless told otherwise.`,
      });
    }
  }

  // Build prior messages for Anthropic (skip tool/system).
  const priorRes = await c.env.DB.prepare(
    `SELECT * FROM chat_messages WHERE thread_id = ?1 ORDER BY created_at`,
  ).bind(thread.id).all<ChatMessageRow>();
  const priorMessages = priorRes.results ?? [];

  const anthropicMessages: Anthropic.MessageParam[] = priorMessages.map(toAnthropic);

  const stream = streamAssistantTurn(c.env, thread.id, systemBlocks, anthropicMessages);
  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
});

const SYSTEM_BASE = `You are the user's personal AI assistant for their relationship CRM, "superconnector".

You have tools to search people, find matches, draft intros, manage tags and followups, run read-only SQL, and dictate updates from freetext. Use them liberally — they're cheap.

When the user gives you freetext info about a person ("Sarah just left OpenAI"), call the dictate tool to extract and apply structured updates. When they ask "who would be a good X for Y", call find_matches. When they want to know what they know about someone, call search_people then brief_for.

Always keep your final natural-language reply tight and concrete. Quote facts, don't restate the JSON.`;

function toAnthropic(m: ChatMessageRow): Anthropic.MessageParam {
  if (m.role === 'user') {
    return { role: 'user', content: m.content ?? '' };
  }
  if (m.role === 'tool' && m.tool_calls) {
    return { role: 'user', content: JSON.parse(m.tool_calls) };
  }
  if (m.role === 'assistant') {
    if (m.tool_calls) {
      return { role: 'assistant', content: JSON.parse(m.tool_calls) };
    }
    return { role: 'assistant', content: m.content ?? '' };
  }
  return { role: 'user', content: m.content ?? '' };
}

function streamAssistantTurn(
  env: Env,
  threadId: string,
  systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }>,
  messages: Anthropic.MessageParam[],
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
      const client = getClient(env);
      const tools = anthropicToolDefs();

      try {
        // Loop until model stops calling tools.
        let working = [...messages];
        for (let turn = 0; turn < 6; turn++) {
          const resp = await client.messages.create({
            model: MODEL_SONNET,
            max_tokens: 2048,
            system: systemBlocks,
            tools: tools as Anthropic.Tool[],
            messages: working,
          });

          // Persist the assistant message.
          await env.DB.prepare(
            `INSERT INTO chat_messages (id, thread_id, role, content, tool_calls, created_at)
             VALUES (?1, ?2, 'assistant', ?3, ?4, ?5)`,
          ).bind(
            ulid(),
            threadId,
            extractText(resp),
            JSON.stringify(resp.content),
            nowIso(),
          ).run();

          // Stream the text portion to the client.
          const text = extractText(resp);
          if (text) send({ type: 'text', text });

          // If no tool use, we're done.
          const toolUses = resp.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
          if (toolUses.length === 0 || resp.stop_reason !== 'tool_use') {
            break;
          }

          // Run each tool, append assistant + tool_result messages, loop.
          working = [...working, { role: 'assistant', content: resp.content }];
          const toolResults: Anthropic.ToolResultBlockParam[] = [];
          for (const tu of toolUses) {
            const write = isWriteTool(tu.name);
            send({ type: 'tool_use', name: tu.name, id: tu.id, write });
            try {
              const out = await runTool(env, tu.name, tu.input);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                content: JSON.stringify(out),
              });
              send({ type: 'tool_result', name: tu.name, id: tu.id, write });
            } catch (err) {
              toolResults.push({
                type: 'tool_result',
                tool_use_id: tu.id,
                content: `error: ${(err as Error).message}`,
                is_error: true,
              });
              send({ type: 'tool_error', name: tu.name, id: tu.id, error: (err as Error).message });
            }
          }
          // Persist tool results.
          await env.DB.prepare(
            `INSERT INTO chat_messages (id, thread_id, role, content, tool_calls, created_at)
             VALUES (?1, ?2, 'tool', NULL, ?3, ?4)`,
          ).bind(ulid(), threadId, JSON.stringify(toolResults), nowIso()).run();

          working.push({ role: 'user', content: toolResults });
        }
        await env.DB.prepare(
          `UPDATE chat_threads SET updated_at = ?1 WHERE id = ?2`,
        ).bind(nowIso(), threadId).run();
        send({ type: 'done' });
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
      } finally {
        controller.close();
      }
    },
  });
}

function extractText(resp: Anthropic.Message): string {
  return resp.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n');
}

export default app;
