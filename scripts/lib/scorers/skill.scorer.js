/**
 * scripts/lib/scorers/skill.scorer.js — F2 scorer for entity_type='skill'.
 *
 * Phase 3.1.2 (F2). Isolated from the central scripts/score.js so each
 * entity_type carries its own scorer that the filter dispatcher invokes
 * via scorers[entity_type](record).
 *
 * Today this is a thin re-export of the existing scoreSkill() that
 * scripts/score.js has already calibrated against real data. F2 does NOT
 * change scoring behaviour. Plugin/MCP scorers slot in alongside this
 * one in 3.2+.
 */

export { scoreSkill } from '../../score.js';
