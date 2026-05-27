/**
 * scripts/lib/scorers/index.js — F2 scorer registry.
 *
 * Phase 3.1.2 (F2). Dispatch table keyed by entity_type. Filter and
 * pipeline scripts call `scorers[record.entity_type](record)` rather
 * than importing scoreSkill directly. Plugin/MCP scorers slot in here
 * in 3.2+ without touching the filter.
 */

import { scoreSkill } from './skill.scorer.js';

/**
 * @typedef {(record: any) => number} Scorer
 */

/** @type {Record<string, Scorer>} */
export const scorers = {
  skill: scoreSkill,
};

/**
 * Dispatch helper. Falls back to a 0 score with a warning if the entity_type
 * is unrecognised (forward-compat for unrecognised future types — the filter
 * still drops them via the rule pack dispatcher).
 *
 * @param {any} record
 * @returns {number}
 */
export function scoreEntity(record) {
  const t = record?.entity_type || 'skill';
  const fn = scorers[t];
  if (!fn) {
    console.warn(`[scorers] no scorer registered for entity_type=${t}; returning 0`);
    return 0;
  }
  return fn(record);
}
