/**
 * scripts/lib/filter-rules/index.js — F2 rule-pack registry.
 *
 * Phase 3.1.2 (F2). Dispatch table for entity-type-specific filter gates.
 * The main filter (scripts/filter.js) layers common gates (always run)
 * + per-type gates (selected by record.entity_type, default 'skill').
 */

import { isSkillSlop } from './skill.rules.js';
import { isPluginSlop } from './plugin.rules.js';
import { isMcpSlop } from './mcp.rules.js';
import {
  hasTemplateName,
  hasPlaceholderDescription,
  hasBizSlopName,
  isFixtureRepo,
  dedupLanguageVariants,
} from './common.rules.js';

/**
 * @typedef {Object} RulePack
 * @property {(record: any) => boolean} isSlop  Return true to REJECT.
 */

/** @type {Record<string, RulePack>} */
export const rulePacks = {
  skill: {
    isSlop: isSkillSlop,
  },
  plugin: {
    isSlop: isPluginSlop,
  },
  mcp_server: {
    isSlop: isMcpSlop,
  },
};

/**
 * Dispatch by entity_type. Falls back to 'skill' when missing (legacy v1
 * records on disk during the cutover window have no entity_type field).
 *
 * @param {any} record
 * @returns {boolean} true if the record should be REJECTED.
 */
export function isSlop(record) {
  // SECURITY gate first — repo-level denylist of scanner/fixture/eval-corpus
  // repos (e.g. claude-skill-antivirus, skill-scanner). Their SKILL.md files
  // are deliberate malicious + benign test fixtures, never real skills. Drop
  // them on every filter pass so a re-scrape can never re-introduce them.
  if (isFixtureRepo(record)) return true;

  // Common gates first — exercised exactly once per record.
  if (hasTemplateName(record)) return true;
  if (hasPlaceholderDescription(record)) return true;
  if (hasBizSlopName(record)) return true;

  // Per-type gates
  const t = record?.entity_type || 'skill';
  const pack = rulePacks[t];
  if (!pack) return false; // unknown type — let it through (per-type gate is the safety net)
  return pack.isSlop(record);
}

export { dedupLanguageVariants };
