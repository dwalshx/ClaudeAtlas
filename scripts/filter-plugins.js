#!/usr/bin/env node

/**
 * scripts/filter-plugins.js — Phase 3.2 plugin filter (D-04, D-05).
 *
 * Reads the REPO-LEVEL raw records in data/plugins-raw.ndjson (F-1: the
 * scraper writes one record per repo with plugin_manifest / components /
 * component_summary — NOT entity-tagged records). For each repo that
 * carries a plugin manifest (or marketplace listing), this script:
 *   1. transforms the repo record → a `plugin` EntityRecord<PluginExtra>
 *      (repoToPluginEntity),
 *   2. upcasts it to the canonical v2 envelope,
 *   3. applies the common + plugin slop gates (isSlop dispatch),
 *   4. scores via scoreEntity (scorePlugin sets extra.manifest_completeness),
 *   5. assigns percentile tiers via the SHARED tier-assignment helper
 *      (D-04: uniform 10/30/60, NO carve-out),
 *   6. assigns slugs (type-agnostic helper, D-08),
 *   7. preserves enrichments (incl. bundled_in_plugins per F-3),
 *   8. writes data/plugins.ndjson with a v2 plugin header sentinel.
 *
 * F1 invariants: NDJSON streaming I/O only; pipeline-stats.json is a
 * bounded sidecar (allowlisted for JSON.stringify pretty-print).
 *
 * Records whose entity_type would be mcp_server are handled by
 * filter-mcps.js (same raw file, different dispatch). Skills inside plugin
 * repos are surfaced via scrape.js / filter.js, not here.
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';
import { assignSlugs } from './lib/slug.js';
import { isSlop } from './lib/filter-rules/index.js';
import { scoreEntity } from './lib/scorers/index.js';
import { assignPercentileTiers } from './lib/tier-assignment.js';
import { upcastRecord } from './lib/legacy-skill-reader.js';
import { buildHeader } from './lib/entity-version.js';
import { deriveTagsFromLegacyCategory, mergeTags, projectCategoryFromTags } from './lib/tags.js';
import { categorizeSkill } from './categorize.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_PATH = join(ROOT, 'data', 'plugins-raw.ndjson');
const OUTPUT_PATH = join(ROOT, 'data', 'plugins.ndjson');
const STATS_PATH = join(ROOT, 'data', 'pipeline-stats.json');

const README_TRIM = 1500;

// F-3: enrichment fields preserved across daily runs (mirrors filter.js).
const PRESERVED_FIELDS = [
  'is_duplicate',
  'canonical_id',
  'canonical_slug',
  'novelty_score',
  'bundled_in_plugins',
];

/** A repo carries a plugin if it has a populated plugin_manifest. */
function hasPluginManifest(raw) {
  return raw && raw.plugin_manifest && typeof raw.plugin_manifest === 'object'
    && Object.keys(raw.plugin_manifest).length > 0;
}

/** Marketplace listing presence (manifestless-but-listed plugins). */
function marketplaceListings(raw) {
  const mm = raw && raw.marketplace_manifest;
  if (!mm || typeof mm !== 'object') return [];
  // A marketplace manifest names the repo as a marketplace; list it.
  return [raw.repo_full_name].filter(Boolean);
}

/** Flatten a `components` section into a list of component names. */
function componentNames(raw, key) {
  const section = raw?.components?.[key];
  if (!section || !Array.isArray(section.entries)) return [];
  return section.entries.map((e) => e?.name).filter((n) => typeof n === 'string');
}

/** Build skill component ids colocated in the same repo. */
function bundledSkillIds(raw) {
  const section = raw?.components?.skills;
  if (!section || !Array.isArray(section.entries)) return [];
  return section.entries
    .map((e) => e?.path)
    .filter((p) => typeof p === 'string')
    .map((p) => `skill:${raw.repo_full_name}/${p}/SKILL.md`);
}

/**
 * Transform a REPO-LEVEL raw record into a tagged plugin EntityRecord
 * (pre-v2 envelope; upcastRecord nests + fills defaults afterwards).
 *
 * @param {any} raw
 * @param {{ readme?: string }} [opts]
 * @returns {any}
 */
export function repoToPluginEntity(raw, opts = {}) {
  const manifest = (raw.plugin_manifest && typeof raw.plugin_manifest === 'object')
    ? raw.plugin_manifest : {};
  const pluginPath = '.claude-plugin/plugin.json';
  const description = raw.description || manifest.description || '';

  const entity = {
    entity_type: 'plugin',
    name: manifest.name || (raw.repo_full_name || '').split('/').pop() || '',
    description,
    repo_full_name: raw.repo_full_name || '',
    repo_url: raw.repo_full_name ? `https://github.com/${raw.repo_full_name}` : '',
    repo_stars: raw.stars ?? 0,
    repo_forks: raw.forks ?? 0,
    repo_open_issues: raw.open_issues ?? 0,
    repo_topics: Array.isArray(raw.topics) ? raw.topics : [],
    repo_license: raw.license ?? null,
    repo_language: raw.language ?? null,
    repo_created_at: raw.created_at || '',
    repo_updated_at: raw.updated_at || raw.pushed_at || '',
    repo_pushed_at: raw.pushed_at || '',
    repo_owner_type: raw.owner_type || 'User',
    repo_owner_avatar: raw.owner_avatar || '',
    repo_archived: Boolean(raw.archived),
    repo_is_fork: Boolean(raw.is_fork),
    repo_description: raw.description ?? null,
    body_length: (opts.readme || '').length,
    scraped_at: raw.scraped_at || '',
    source: 'discover',
    discovery_signals: Array.isArray(raw.discovery_sources) ? raw.discovery_sources : ['plugin'],
    repo_default_branch: raw.default_branch ?? null,
    extra: {
      type: 'plugin',
      plugin_path: pluginPath,
      manifest,
      readme_markdown: opts.readme || '',
      commands: componentNames(raw, 'commands'),
      hooks: componentNames(raw, 'hooks'),
      marketplace_listings: marketplaceListings(raw),
      bundled_skills: bundledSkillIds(raw),
      bundled_agents: componentNames(raw, 'agents'),
      bundled_commands: componentNames(raw, 'commands'),
      bundled_hooks: componentNames(raw, 'hooks'),
      bundled_mcp_servers: [], // populated by link-bundles.js from mcp records
    },
  };
  return entity;
}

/** Derive + merge category tags for a plugin entity. */
function applyTags(entity) {
  const category = categorizeSkill(entity);
  entity.category = category;
  const categoryTags = mergeTags(deriveTagsFromLegacyCategory(category));
  const existing = Array.isArray(entity.tags) ? entity.tags.filter((t) => typeof t === 'string') : [];
  entity.tags = categoryTags.concat(existing.filter((t) => !categoryTags.includes(t)));
  if (!entity.category) entity.category = projectCategoryFromTags(entity.tags);
}

/**
 * Pure in-memory plugin filter pipeline (exported for tests).
 *
 * @param {Array<any>} raw  repo-level raw records.
 * @param {Map<string, object>} [priorEnrichments]  id -> preserved fields.
 * @param {{ readme?: string }} [opts]
 * @returns {{ records: any[], tiers: {featured:number,solid:number,listed:number} }}
 */
export function filterPluginsRaw(raw, priorEnrichments = new Map(), opts = {}) {
  // 1. Only repos that look like plugins (manifest OR marketplace listing).
  const candidates = raw.filter(
    (r) => hasPluginManifest(r) || marketplaceListings(r).length > 0,
  );

  // 2. Transform → entity, 3. upcast to v2.
  let records = candidates
    .map((r) => repoToPluginEntity(r, opts))
    .map(upcastRecord);

  // 4. Tag, then 5. slop gate.
  for (const e of records) applyTags(e);
  records = records.filter((e) => !isSlop(e));

  // 6. Score (sets extra.manifest_completeness).
  for (const e of records) e.quality_score = scoreEntity(e);

  // 7. Tier (shared helper — D-04, no carve-out, no renderableCap).
  assignPercentileTiers(records);

  // 8. Slugs (type-agnostic).
  assignSlugs(records);

  // 9. Trim readme; preserve body_length invariant (mirror filter.js).
  for (const e of records) {
    if (e.extra && typeof e.extra.readme_markdown === 'string'
        && e.extra.readme_markdown.length > README_TRIM) {
      e.extra.readme_markdown = e.extra.readme_markdown.substring(0, README_TRIM) + '...';
    }
  }

  // 10. Preserve enrichments across runs (incl. bundled_in_plugins, F-3).
  // A freshly-upcast record carries DEFAULT empty values (bundled_in_plugins
  // = [], is_duplicate = false). Treat those defaults as "absent" so a
  // non-empty prior enrichment is restored rather than clobbered.
  for (const e of records) {
    const prior = priorEnrichments.get(e.id);
    if (!prior) continue;
    for (const field of PRESERVED_FIELDS) {
      if (prior[field] == null) continue;
      const cur = e[field];
      const isDefault =
        cur == null ||
        cur === false ||
        (Array.isArray(cur) && cur.length === 0);
      if (isDefault) e[field] = prior[field];
    }
  }

  const tiers = {
    featured: records.filter((e) => e.quality_tier === 'featured').length,
    solid: records.filter((e) => e.quality_tier === 'solid').length,
    listed: records.filter((e) => e.quality_tier === 'listed').length,
  };
  return { records, tiers };
}

/** Load prior plugin enrichments keyed by id (PRESERVED_FIELDS). */
function loadPriorEnrichments() {
  if (!existsSync(OUTPUT_PATH)) return new Map();
  try {
    const prior = [...readNdjsonRecords(OUTPUT_PATH, { keyFn: (r) => r.id }).values()];
    const map = new Map();
    for (const p of prior) {
      if (!p || !p.id) continue;
      const e = {};
      let any = false;
      for (const f of PRESERVED_FIELDS) {
        if (p[f] != null) { e[f] = p[f]; any = true; }
      }
      if (any) map.set(p.id, e);
    }
    return map;
  } catch {
    return new Map();
  }
}

function main() {
  if (!existsSync(RAW_PATH)) {
    console.warn(`[filter-plugins] WARN: ${RAW_PATH} missing; nothing to filter. Exiting 0.`);
    process.exit(0);
  }
  console.log('=== ClaudeAtlas Plugin Filter ===');
  const raw = [...readNdjsonRecords(RAW_PATH, { keyFn: (r) => r.repo_full_name }).values()];
  console.log(`Raw repo records: ${raw.length}`);

  const prior = loadPriorEnrichments();
  const { records, tiers } = filterPluginsRaw(raw, prior);

  console.log(`Plugins after filter: ${records.length}`);
  console.log(`Tiers: ${tiers.featured} Featured, ${tiers.solid} Solid, ${tiers.listed} Listed`);

  writeNdjsonStreaming(OUTPUT_PATH, records, { header: buildHeader('plugin') });
  console.log(`Written to ${OUTPUT_PATH} (schema_version=2; entity_type=plugin)`);

  // Merge plugin stats into pipeline-stats.json WITHOUT clobbering skill stats.
  let stats = {};
  if (existsSync(STATS_PATH)) {
    try { stats = JSON.parse(readFileSync(STATS_PATH, 'utf-8')); } catch { stats = {}; }
  }
  stats.plugin = {
    timestamp: new Date().toISOString(),
    total_raw_repos: raw.length,
    total_plugins: records.length,
    tiers,
  };
  writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), 'utf-8');
}

const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();
