import type { Env } from '../../worker-configuration';

// JSON Schema (subset that Anthropic + MCP both accept).
export interface JsonSchema {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  enum?: string[];
  required?: string[];
  additionalProperties?: boolean;
}

export interface Tool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  handler: (env: Env, input: I) => Promise<O>;
}

// Anthropic tool_use format (used when calling Claude API).
export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: JsonSchema;
}

export function toAnthropicTool(t: Tool): AnthropicToolDef {
  return {
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema,
  };
}

// MCP tools/list format (camelCase inputSchema per MCP 2025-03-26 spec).
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: JsonSchema;
}

export function toMcpTool(t: Tool): McpToolDef {
  return {
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  };
}
