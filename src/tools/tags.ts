import type { Tool } from './types';
import { ulid, nowIso } from '../lib/ulid';

interface ApplyInput {
  person_id: string;
  tag_name: string;
  category?: 'trajectory' | 'topic' | 'skill' | 'free';
}

export const applyTagTool: Tool<ApplyInput, { tag_id: string; created: boolean }> = {
  name: 'apply_tag',
  description: 'Add a tag to a person. Creates the tag if it does not exist.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string' },
      tag_name: { type: 'string' },
      category: { type: 'string', enum: ['trajectory', 'topic', 'skill', 'free'] },
    },
    required: ['person_id', 'tag_name'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const tagName = input.tag_name.trim().toLowerCase();
    let created = false;
    let tagId: string;
    const existing = await env.DB.prepare('SELECT id FROM tags WHERE name = ?1').bind(tagName).first<{ id: string }>();
    if (existing) {
      tagId = existing.id;
    } else {
      tagId = ulid();
      await env.DB.prepare(
        `INSERT INTO tags (id, name, category, created_at) VALUES (?1, ?2, ?3, ?4)`,
      ).bind(tagId, tagName, input.category ?? 'free', nowIso()).run();
      created = true;
    }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO person_tags (person_id, tag_id, source_meeting_id, created_at)
       VALUES (?1, ?2, NULL, ?3)`,
    ).bind(input.person_id, tagId, nowIso()).run();
    return { tag_id: tagId, created };
  },
};

interface RemoveInput {
  person_id: string;
  tag_name: string;
}

export const removeTagTool: Tool<RemoveInput, { ok: true }> = {
  name: 'remove_tag',
  description: 'Remove a tag from a person. The tag itself is not deleted.',
  inputSchema: {
    type: 'object',
    properties: {
      person_id: { type: 'string' },
      tag_name: { type: 'string' },
    },
    required: ['person_id', 'tag_name'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const tagName = input.tag_name.trim().toLowerCase();
    await env.DB.prepare(
      `DELETE FROM person_tags WHERE person_id = ?1
         AND tag_id IN (SELECT id FROM tags WHERE name = ?2)`,
    ).bind(input.person_id, tagName).run();
    return { ok: true } as const;
  },
};

export const reviewTagProposalTool: Tool<
  {
    proposal_id: string;
    decision: 'accept' | 'merge' | 'reject';
    merge_into_tag_name?: string;
    accepted_category?: 'trajectory' | 'topic' | 'skill' | 'free';
  },
  { ok: true }
> = {
  name: 'review_tag_proposal',
  description:
    'Resolve a pending tag_proposal: accept (creates the tag and applies it to all example people), merge into an existing tag, or reject.',
  inputSchema: {
    type: 'object',
    properties: {
      proposal_id: { type: 'string' },
      decision: { type: 'string', enum: ['accept', 'merge', 'reject'] },
      merge_into_tag_name: { type: 'string' },
      accepted_category: { type: 'string', enum: ['trajectory', 'topic', 'skill', 'free'] },
    },
    required: ['proposal_id', 'decision'],
    additionalProperties: false,
  },
  async handler(env, input) {
    const proposal = await env.DB.prepare(
      'SELECT * FROM tag_proposals WHERE id = ?1',
    ).bind(input.proposal_id).first<{
      id: string;
      proposed_name: string;
      proposed_category: string | null;
      example_person_ids: string | null;
      status: string;
    }>();
    if (!proposal) throw new Error('proposal not found');

    const examples: string[] = JSON.parse(proposal.example_person_ids ?? '[]');

    if (input.decision === 'reject') {
      await env.DB.prepare(
        'UPDATE tag_proposals SET status = ?1 WHERE id = ?2',
      ).bind('rejected', proposal.id).run();
      return { ok: true } as const;
    }

    let targetTagId: string;
    if (input.decision === 'merge') {
      if (!input.merge_into_tag_name) throw new Error('merge_into_tag_name required for merge');
      const target = await env.DB.prepare(
        'SELECT id FROM tags WHERE name = ?1',
      ).bind(input.merge_into_tag_name.toLowerCase()).first<{ id: string }>();
      if (!target) throw new Error('target tag not found');
      targetTagId = target.id;
      await env.DB.prepare(
        `UPDATE tag_proposals SET status = 'merged_into', merged_into_tag_id = ?1 WHERE id = ?2`,
      ).bind(targetTagId, proposal.id).run();
    } else {
      // accept: create the tag.
      targetTagId = ulid();
      await env.DB.prepare(
        `INSERT INTO tags (id, name, category, created_at) VALUES (?1, ?2, ?3, ?4)`,
      ).bind(
        targetTagId,
        proposal.proposed_name.toLowerCase(),
        input.accepted_category ?? proposal.proposed_category ?? 'free',
        nowIso(),
      ).run();
      await env.DB.prepare(
        `UPDATE tag_proposals SET status = 'accepted' WHERE id = ?1`,
      ).bind(proposal.id).run();
    }

    for (const personId of examples) {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO person_tags (person_id, tag_id, source_meeting_id, created_at)
         VALUES (?1, ?2, NULL, ?3)`,
      ).bind(personId, targetTagId, nowIso()).run();
    }
    return { ok: true } as const;
  },
};
