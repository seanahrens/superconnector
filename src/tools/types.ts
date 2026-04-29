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

// Anthropic tool_use format. Same shape MCP uses for `tools/list`.
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
