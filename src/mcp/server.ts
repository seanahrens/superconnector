// Minimal MCP server (JSON-RPC 2.0 over HTTP) exposing the shared tool layer.
// Speaks the 2025-03-26 Streamable HTTP transport at the protocol level: it
// accepts POSTed JSON-RPC requests and returns JSON responses.
//
// Auth: a shared secret via the `Authorization: Bearer <MCP_SECRET>` header.

import type { Env } from '../../worker-configuration';
import { ALL_TOOLS, runTool } from '../tools';
import { toMcpTool } from '../tools/types';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = '2025-03-26';

export async function handleMcp(env: Env, req: Request): Promise<Response> {
  if (req.method === 'GET') {
    return new Response('mcp endpoint — POST JSON-RPC here', { status: 200 });
  }
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }
  const authResult = isAuthorized(env, req);
  if (authResult !== 'ok') {
    return new Response(authResult === 'misconfigured' ? 'server misconfigured' : 'unauthorized', {
      status: authResult === 'misconfigured' ? 503 : 401,
    });
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }

  const result = await dispatch(env, body);
  return jsonRpcResponse(result);
}

// Returns 'ok' when the request is authenticated, 'misconfigured' when the
// secret is missing in a non-dev environment (fail closed), 'forbidden'
// otherwise. Local dev (ENVIRONMENT === 'development') with no secret is
// allowed for convenience.
function isAuthorized(env: Env, req: Request): 'ok' | 'misconfigured' | 'forbidden' {
  const expected = env.MCP_SECRET;
  const isDev = env.ENVIRONMENT === 'development';
  if (!expected) {
    if (isDev) return 'ok';
    console.error('mcp: MCP_SECRET unset in non-dev environment — refusing request');
    return 'misconfigured';
  }
  const got = req.headers.get('authorization') ?? '';
  return got === `Bearer ${expected}` ? 'ok' : 'forbidden';
}

async function dispatch(env: Env, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  const id = req.id ?? null;
  try {
    switch (req.method) {
      case 'initialize':
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: 'superconnector', version: '0.1.0' },
          },
        };
      case 'tools/list':
        return {
          jsonrpc: '2.0',
          id,
          result: { tools: ALL_TOOLS.map(toMcpTool) },
        };
      case 'tools/call': {
        const params = (req.params ?? {}) as { name: string; arguments?: unknown };
        if (!params.name) throw new Error('tools/call: missing name');
        const out = await runTool(env, params.name, params.arguments ?? {});
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(out, null, 2) }],
            isError: false,
          },
        };
      }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} };
      case 'notifications/initialized':
        // Notification — no response body needed, but return empty success.
        return { jsonrpc: '2.0', id, result: {} };
      default:
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `method not found: ${req.method}` },
        };
    }
  } catch (err) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: -32000, message: (err as Error).message },
    };
  }
}

function jsonRpcResponse(body: JsonRpcResponse): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
