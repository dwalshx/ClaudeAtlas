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

// SECURITY (additive exclusion — NOT a filter recalibration).
//
// Repo-level denylist: every record whose `repo_full_name` matches an entry
// here is DROPPED before scoring/tiering, on EVERY filter pass (so a re-scrape
// can never re-introduce them).
//
// These are skill-SCANNER / antivirus / eval-corpus repos whose SKILL.md files
// are DELIBERATE TEST FIXTURES — malicious samples (e.g. curl|bash data-exfil,
// jailbreak / prompt-injection payloads) plus benign samples — used to TEST
// scanners. They are NOT real, installable skills and must NEVER appear in the
// curated index. This is an exact `repo_full_name` match ONLY: it does not key
// off paths (e.g. `examples/`, `evals/`, `tests/`), because ~95 legitimate
// example skills live in guide/tutorial repos under those paths and must NOT
// be removed.
//
// Extend this list as more scanner / fixture repos are discovered.
export const FIXTURE_REPO_DENYLIST = new Set([
  'claude-world/claude-skill-antivirus',
  'cisco-ai-defense/skill-scanner',
  // Phase 3.2.1 (Audit B FP-calibration scan, 2026-06-10; human-verified 2026-06-11):
  'majiayu000/claude-skill-registry',       // aggregator-mirror: auto-generated registry mirror w/ prompt-injection-test fixtures
  'majiayu000/claude-skill-registry-data',  // data twin of the above (same mirror corpus + fixtures)
  'liminal-ai/skill-scanner-ts',            // scanner-port: TS port of cisco-ai-defense/skill-scanner w/ embedded eval fixtures
  'RekitRex21/Dino_Scan',                   // scanner: security-scanner repo (preventive; 0 current filtered records)
]);

/**
 * Return true if the record belongs to a denylisted scanner / fixture repo
 * (exact `repo_full_name` match). Such records must be dropped entirely.
 *
 * @param {{ repo_full_name?: string }} record
 */
export function isFixtureRepo(record) {
  return FIXTURE_REPO_DENYLIST.has(record?.repo_full_name);
}

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
