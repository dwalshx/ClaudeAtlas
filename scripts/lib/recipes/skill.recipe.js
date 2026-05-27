/**
 * scripts/lib/recipes/skill.recipe.js — F2 skill-entity recipe.
 *
 * Phase 3.1.2 (F2). The first DiscoveryRecipe implementation. In F2 this
 * is a thin shape that exposes the existing scripts/scrape.js + parse-skill
 * verbs through the recipe interface. The legacy scrape.js remains the
 * production entry point during this transition; plugin/MCP recipes added
 * in 3.2+ slot in alongside via scripts/lib/recipes/index.js without
 * touching scrape.js.
 *
 * Smoke D (T11) verifies that a `plugin.recipe.js` stub authored locally
 * loads through the same shape.
 */

import { parseSkill } from '../../parse-skill.js';

/** @type {import('../recipe-engine.js').DiscoveryRecipe} */
export const skillRecipe = {
  entity_type: 'skill',
  output_path: 'data/skills-raw.ndjson',
  state_path: 'data/skills-raw.checkpoint.json',

  /**
   * Discover skill hits. In F2 the real discovery loop still lives in
   * scripts/scrape.js (battle-tested ETag + checkpoint logic). This
   * generator is a placeholder that yields nothing — runRecipe()
   * driven against this recipe returns 0 records. The shape is the
   * point: a plugin recipe replaces this body with its own discovery
   * pass and the engine handles the rest.
   */
  async *discover() {
    // Reserved for future recipe-engine-driven runs. F2 production path
    // is `scripts/scrape.js` → existing two-track discovery → writes
    // EntityRecord<SkillExtra> via the upcaster.
    return;
  },

  /**
   * Parse a raw SKILL.md hit into the SkillExtra-shaped portion of an
   * EntityRecord. The engine fills in entity_type + id; the recipe
   * supplies the parsed payload.
   *
   * @param {{ raw_content: string, path: string }} hit
   */
  async parse(hit) {
    if (!hit || typeof hit.raw_content !== 'string') return null;
    const parsed = parseSkill(hit.raw_content, hit.path || '');
    if (!parsed) return null;
    return {
      // SkillExtra fields the recipe contributes (engine completes the envelope):
      extra: {
        type: 'skill',
        skill_path: hit.path || '',
        body_markdown: parsed.body_markdown,
        frontmatter: parsed.frontmatter,
        has_name: parsed.has_name,
        has_description: parsed.has_description,
        skill_first_commit_at: null,
      },
      // EntityCommon fields the recipe can pre-populate from the parsed hit:
      name: parsed.name,
      description: parsed.description,
    };
  },

  /**
   * Compute the canonical EntityRecord.id for a skill record. The id
   * shape is `${entity_type}:${repo_full_name}/${path_within_repo}` per
   * src/lib/types.d.ts EntityCommon.id.
   */
  computeId(rec) {
    const repo = rec.repo_full_name || '';
    const path = rec.extra?.skill_path || '';
    return `skill:${repo}/${path}`;
  },
};
