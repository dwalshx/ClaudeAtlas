/**
 * scripts/lib/filter-rules/common.rules.js — F2 entity-type-agnostic gates.
 *
 * Phase 3.1.2 (F2). Shared gates that apply to every entity type:
 *   - Template/placeholder name rejection
 *   - Placeholder description pattern rejection
 *   - Business-domain AI-slop name pattern rejection
 *   - Language-variant dedup
 *
 * Phase 3.1 dropped MAX_PER_REPO + MIN_STARS — embedding dedup is the
 * gate now (see scripts/enrich.js). Those gates are NOT reintroduced here.
 */

export const TEMPLATE_NAMES = new Set([
  'agent-name', 'skill-name', 'example', 'example-skill', 'template',
  'my-skill', 'sample', 'sample-skill', 'untitled', 'new-skill',
  'placeholder', 'test', 'test-skill', 'hello-world', 'default',
]);

export const PLACEHOLDER_DESC_PATTERNS = [
  /^one paragraph describing/i,
  /^describe what this/i,
  /^your description here/i,
  /^\[.*\]/,
  /^brief description of/i,
  /^this is a (sample|test|placeholder|template)/i,
];

export const BIZ_SLOP_PATTERNS = [
  /^(carrier|customs|energy|inventory|logistics|production|quality|returns|warehouse|fleet|freight|procurement|supply-chain|vendor|contract|compliance|audit|risk|incident|outage|regulatory)-/,
  /-management$/,
  /-compliance$/,
  /-optimization$/,
];

export const LANG_SUFFIXES = /-(ar|de|es|fr|ja|ko|pt|ru|zh|zh-cn|zh-tw|zhs|zht|it|nl|pl|tr|hi|id|vi|th|sv|da|no|fi|cs|el|he|uk)$/i;

/**
 * Return true if the record's name is a template/placeholder.
 *
 * @param {{ name?: string }} record
 */
export function hasTemplateName(record) {
  return TEMPLATE_NAMES.has((record?.name || '').toLowerCase());
}

/**
 * Return true if the description matches a placeholder pattern.
 *
 * @param {{ description?: string }} record
 */
export function hasPlaceholderDescription(record) {
  const desc = (record?.description || '').toLowerCase();
  return PLACEHOLDER_DESC_PATTERNS.some((p) => p.test(desc));
}

/**
 * Return true if the name matches a business-domain AI-slop pattern.
 *
 * @param {{ name?: string }} record
 */
export function hasBizSlopName(record) {
  const name = (record?.name || '').toLowerCase();
  return BIZ_SLOP_PATTERNS.some((p) => p.test(name));
}

/**
 * Return true if the record's description is shorter than `minLen` chars
 * (after trim). Shared by the plugin + MCP slop gates (Phase 3.2 D-05).
 *
 * @param {{ description?: string }} record
 * @param {number} minLen
 */
export function hasShortDescription(record, minLen) {
  return (record?.description || '').trim().length < minLen;
}

/**
 * Dedup by base name (strip language suffix). Preserves the highest-quality
 * variant within each (repo, base_name) bucket.
 *
 * @param {Array<{ name: string, repo_full_name: string, quality_score?: number }>} records
 */
export function dedupLanguageVariants(records) {
  const seen = new Map();
  for (const rec of records) {
    const baseName = (rec.name || '').replace(LANG_SUFFIXES, '');
    const key = `${rec.repo_full_name}/${baseName}`;
    const existing = seen.get(key);
    if (!existing || rec.name === baseName || (rec.quality_score || 0) > (existing.quality_score || 0)) {
      seen.set(key, rec);
    }
  }
  return [...seen.values()];
}
