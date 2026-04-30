// Single registry of every tool the system exposes. Both the MCP server and
// the web chat endpoint consume this list — keeps tool surface identical.

import type { Env } from '../../worker-configuration';
import type { Tool, AnthropicToolDef } from './types';
import { toAnthropicTool } from './types';

import { searchPeople } from './search_people';
import { findMatchesTool } from './find_matches';
import { briefForTool } from './brief_for';
import { draftIntroTool } from './draft_intro';
import { listPendingConfirmationsTool, resolveConfirmationTool } from './queue';
import { applyTagTool, removeTagTool, reviewTagProposalTool } from './tags';
import { addPersonTool, updatePersonTool } from './people_mut';
import { dictateTool } from './dictate';
import { queryDbTool } from './query_db';
import { addFollowupTool, completeFollowupTool } from './followups';

export const ALL_TOOLS: Tool[] = [
  searchPeople,
  findMatchesTool,
  briefForTool,
  draftIntroTool,
  listPendingConfirmationsTool,
  resolveConfirmationTool,
  applyTagTool,
  removeTagTool,
  reviewTagProposalTool,
  addPersonTool,
  updatePersonTool,
  dictateTool,
  queryDbTool,
  addFollowupTool,
  completeFollowupTool,
] as Tool[];

const TOOL_INDEX = new Map(ALL_TOOLS.map((t) => [t.name, t]));

const WRITE_TOOLS = new Set<string>([
  'resolve_confirmation',
  'apply_tag',
  'remove_tag',
  'review_tag_proposal',
  'add_person',
  'update_person',
  'dictate',
  'add_followup',
  'complete_followup',
]);

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

export function getTool(name: string): Tool | undefined {
  return TOOL_INDEX.get(name);
}

export function anthropicToolDefs(): AnthropicToolDef[] {
  return ALL_TOOLS.map(toAnthropicTool);
}

export async function runTool(env: Env, name: string, input: unknown): Promise<unknown> {
  const tool = TOOL_INDEX.get(name);
  if (!tool) throw new Error(`unknown tool: ${name}`);
  return await tool.handler(env, input);
}
