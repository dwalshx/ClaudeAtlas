/**
 * scripts/lib/filter-rules/skill.rules.js — F2 skill-specific gates.
 *
 * Phase 3.1.2 (F2). Per-entity-type gates that apply only to skill
 * records. Common gates (template names, placeholder descriptions,
 * lang-variant dedup) live in common.rules.js.
 */

const MIN_BODY_LENGTH_DEFAULT = 200; // matches Phase 3.1 calibration

/**
 * Skill-specific slop gate. Mirrors the original scripts/filter.js:isSlop
 * skill-portion: requires sufficient body length AND at least one of
 * frontmatter name/description.
 *
 * Accepts either a v1 flat skill record OR a v2 EntityRecord<SkillExtra>
 * (per the dual-shape upcaster — has_name/has_description live both at
 * top level and inside extra during the cutover window).
 *
 * @param {any} record
 * @param {{ minBodyLength?: number }} [opts]
 * @returns {boolean} true if the record should be REJECTED.
 */
export function isSkillSlop(record, opts = {}) {
  const minBody = opts.minBodyLength ?? MIN_BODY_LENGTH_DEFAULT;

  // Body too short
  if ((record?.body_length || 0) < minBody) return true;

  // Missing both name AND description in frontmatter
  const hasName = record?.has_name ?? record?.extra?.has_name ?? false;
  const hasDesc = record?.has_description ?? record?.extra?.has_description ?? false;
  if (!hasName && !hasDesc) return true;

  return false;
}
