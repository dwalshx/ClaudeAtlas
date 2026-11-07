/**
 * scripts/filter-apis.js
 *
 * Phase 4.2 (D-03, D-05, 4.2-M07/M08) — api filter. Clone of
 * filter-plugins.js with four substitutions:
 *   (1) raw read keyed by origin.source + ':' + origin.source_id (Pitfall 4 —
 *       cross-source ids collide before the merge),
 *   (2) mergeApiRecords before upcastRecord,
 *   (3) categorizeSkill fed with repo_topics = extra.categories_src,
 *   (4) nested extra.consumed_by preserved alongside PRESERVED_FIELDS
 *       (Phase 4.6 writes it).
 * No RENDERABLE_CAP for api in 4.2 (no pages). scripts/filter.js and score.js
 * untouched (D-08).
 *
 * Reads data/apis-raw.ndjson, writes data/apis.ndjson (header sentinel) and
 * the `api` section of data/pipeline-stats.json. Pre-flight: exits 1 below
 * MIN_API_RAW raw records or when any source contributed zero.
 */

import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';
import { assignSlugs } from './lib/slug.js';
import { isSlop } from './lib/filter-rules/index.js';
import {
  isFixtureRepo, hasTemplateName, hasPlaceholderDescription, hasBizSlopName, hasShortDescription,
} from './lib/filter-rules/common.rules.js';
import { scoreEntity } from './lib/scorers/index.js';
import { assignPercentileTiers } from './lib/tier-assignment.js';
import { upcastRecord } from './lib/legacy-skill-reader.js';
import { buildHeader } from './lib/entity-version.js';
import { deriveTagsFromLegacyCategory, mergeTags, projectCategoryFromTags } from './lib/tags.js';
import { categorizeSkill } from './categorize.js';
import { mergeApiRecords, SOURCE_PRECEDENCE } from './lib/feeds/api-merge.js';
import { slugify } from './lib/feeds/text.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const RAW_PATH = join(ROOT, 'data', 'apis-raw.ndjson');
const OUTPUT_PATH = join(ROOT, 'data', 'apis.ndjson');
const STATS_PATH = join(ROOT, 'data', 'pipeline-stats.json');

export const MIN_API_RAW = 1000;
export const SOURCES = ['apis.guru', 'data.gouv.fr', 'uk-api-catalogue', 'public-apis'];
// F-3: enrichment fields preserved across daily runs (verbatim from filter-plugins.js; Known-issue 11).
export const PRESERVED_FIELDS = ['is_duplicate', 'canonical_id', 'canonical_slug', 'novelty_score', 'bundled_in_plugins'];
const GATES = ['fixture_repo', 'template_name', 'placeholder_description', 'biz_slop', 'short_description', 'no_home_url', 'no_base_or_spec'];
const MIN_DESCRIPTION_LENGTH = 50;

// Includes content_sha: source_id is not unique within a source (UK HMRC rows share one url,
// public-apis names repeat across categories). Keep in sync with harvest-apis.js rawKey.
export const rawKey = (r) => `${r?.origin?.source}:${r?.origin?.source_id}:${r?.content_sha}`;

/** Per-source counts over the 4 SOURCES (0 when absent). */
export function countBySource(raw) {
  const c = Object.fromEntries(SOURCES.map((s) => [s, 0]));
  for (const r of raw || []) {
    const s = r?.origin?.source;
    if (s in c) c[s]++;
  }
  return c;
}

/** Throws a FATAL Error below MIN_API_RAW or when any source count is 0; returns countBySource(raw). */
export function preflight(raw) {
  const by = countBySource(raw);
  if (raw.length < MIN_API_RAW) {
    throw new Error(`[filter-apis] FATAL: only ${raw.length} raw records (expected >= ${MIN_API_RAW}). Check harvest-apis.js output / the apis-raw GHA cache.`);
  }
  for (const s of SOURCES) {
    if (by[s] === 0) {
      throw new Error(`[filter-apis] FATAL: source ${s} returned 0 records in the raw file. Check harvest-apis.js / the ${s} endpoint.`);
    }
  }
  return by;
}

/**
 * First failing gate, in isSlop order (common pack, then the api pack); null when kept.
 *
 * @returns {null | 'fixture_repo' | 'template_name' | 'placeholder_description' | 'biz_slop' | 'short_description' | 'no_home_url' | 'no_base_or_spec'}
 */
export function dropReason(e) {
  if (isFixtureRepo(e)) return 'fixture_repo';
  if (hasTemplateName(e)) return 'template_name';
  if (hasPlaceholderDescription(e)) return 'placeholder_description';
  if (hasBizSlopName(e)) return 'biz_slop';
  if (hasShortDescription(e, MIN_DESCRIPTION_LENGTH)) return 'short_description';
  if (!(typeof e?.home_url === 'string' && e.home_url)) return 'no_home_url';
  const x = e?.extra || {};
  const hasBase = Array.isArray(x.base_urls) && x.base_urls.length > 0;
  const hasSpec = typeof x.spec_url === 'string' && x.spec_url.length > 0;
  if (!hasBase && !hasSpec) return 'no_base_or_spec';
  return null;
}

/** 10 buckets [0,0.1) … [0.9,1.0]; 1.0 lands in the last bucket. */
export function accessClarityHistogram(records) {
  const h = new Array(10).fill(0);
  for (const r of records || []) {
    const v = Number(r?.extra?.access_clarity) || 0;
    h[Math.min(9, Math.max(0, Math.floor(v * 10)))]++;
  }
  return h;
}

/** Substitution 3: source-native categories count as topics for the keyword categorizer. */
function applyTags(entity) {
  const category = categorizeSkill({
    name: entity.name,
    description: entity.description,
    repo_topics: entity.extra?.categories_src || [],
    tags: entity.tags || [],
  });
  entity.category = category;
  const categoryTags = mergeTags(deriveTagsFromLegacyCategory(category));
  const existing = Array.isArray(entity.tags) ? entity.tags.filter((t) => typeof t === 'string') : [];
  entity.tags = categoryTags.concat(existing.filter((t) => !categoryTags.includes(t)));
  if (!entity.category) entity.category = projectCategoryFromTags(entity.tags);
}

const emptyConsumed = (c) => !c || ['skills', 'plugins', 'mcp_servers'].every((k) => !Array.isArray(c[k]) || c[k].length === 0);
// The upcaster defaults novelty_score to 0 (not null), so 0 is "not enriched yet" for that field.
const isDefaultValue = (v, field) => v == null || v === false || (Array.isArray(v) && v.length === 0)
  || (field === 'novelty_score' && v === 0);
const rankOf = (e) => {
  const i = SOURCE_PRECEDENCE.indexOf(e?.origin?.source);
  return i === -1 ? SOURCE_PRECEDENCE.length : i;
};
const strCmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Pure in-memory api filter pipeline (exported for tests).
 *
 * @param {any[]} raw  raw api records (harvest-apis.js output)
 * @param {Map<string, object>} [priorEnrichments]  id → preserved fields (+ consumed_by)
 */
export function filterApisRaw(raw, priorEnrichments = new Map()) {
  const total_raw = raw.length;
  const rawBySource = countBySource(raw);

  // Substitution 2: cross-source merge BEFORE upcast.
  const { merged, stats: mergeStats } = mergeApiRecords(raw);
  let records = merged.map(upcastRecord);

  // Id-collision guard: different merge keys can still compute the SAME id
  // (same provider + name on different hosts, or the host-less provider
  // fallback). apis.ndjson is keyed by id downstream, so colliders would be
  // silently dropped. Deterministic: order colliders by SOURCE_PRECEDENCE then
  // origin.source_id; the first keeps the id, the rest get a suffix.
  let id_collisions = 0;
  {
    const groups = new Map();
    for (const e of records) {
      if (!groups.has(e.id)) groups.set(e.id, []);
      groups.get(e.id).push(e);
    }
    for (const [id, group] of groups) {
      if (group.length < 2) continue;
      group.sort((a, b) => (rankOf(a) - rankOf(b)) || strCmp(String(a.origin?.source_id ?? ''), String(b.origin?.source_id ?? '')));
      for (const e of group.slice(1)) {
        const nid = `${id}~${slugify(e.origin?.source ?? '')}-${slugify(e.origin?.source_id ?? '')}`;
        console.warn(`[filter-apis] id collision: ${id} (${e.origin?.source}:${e.origin?.source_id}) -> ${nid}`);
        e.id = nid;
        id_collisions++;
      }
    }
  }

  for (const e of records) applyTags(e);

  const dropped = Object.fromEntries(GATES.map((g) => [g, 0]));
  const dropped_names = Object.fromEntries(GATES.map((g) => [g, []]));
  const kept = [];
  for (const e of records) {
    const why = dropReason(e);
    if (why) {
      dropped[why]++;
      dropped_names[why].push(`${e.origin?.source}:${e.name}`);
    } else if (!isSlop(e)) {
      kept.push(e);
    } else {
      // dropReason mirrors isSlop; belt-and-braces, should never fire.
      dropped.no_base_or_spec++;
      dropped_names.no_base_or_spec.push(`${e.origin?.source}:${e.name}`);
    }
  }
  records = kept;

  // Score (sets extra.access_clarity), tier (no renderableCap — D-05), slug.
  for (const e of records) e.quality_score = scoreEntity(e);
  assignPercentileTiers(records);
  assignSlugs(records);

  // PRESERVED_FIELDS (plugin rule: restore prior when current is a default) + nested consumed_by.
  for (const e of records) {
    const prior = priorEnrichments.get(e.id);
    if (!prior) continue;
    for (const field of PRESERVED_FIELDS) {
      if (prior[field] == null) continue;
      if (isDefaultValue(e[field], field)) e[field] = prior[field];
    }
    if (prior.consumed_by && e.extra && emptyConsumed(e.extra.consumed_by) && !emptyConsumed(prior.consumed_by)) {
      e.extra.consumed_by = structuredClone(prior.consumed_by);
    }
  }

  const tiers = {
    featured: records.filter((e) => e.quality_tier === 'featured').length,
    solid: records.filter((e) => e.quality_tier === 'solid').length,
    listed: records.filter((e) => e.quality_tier === 'listed').length,
  };
  const keptBySource = countBySource(records);
  const stats = {
    total_raw,
    total_merged: merged.length,
    total_apis: records.length,
    id_collisions,
    by_source: Object.fromEntries(SOURCES.map((s) => [s, { raw: rawBySource[s], kept: keptBySource[s] }])),
    merged_duplicates: mergeStats.merged_duplicates,
    dropped,
    dropped_names,
    tiers,
    access_clarity_histogram: accessClarityHistogram(records),
  };
  return { records, tiers, stats };
}

/**
 * Prior enrichments keyed by id. Only records with something non-default to
 * preserve are included (fresh records carry is_duplicate=false,
 * bundled_in_plugins=[] and empty consumed_by — nothing to carry).
 *
 * @param {string} [path]
 * @returns {Map<string, object>}
 */
export function loadPriorEnrichments(path = OUTPUT_PATH) {
  if (!existsSync(path)) return new Map();
  try {
    const map = new Map();
    for (const p of readNdjsonRecords(path, { keyFn: (r) => r.id }).values()) {
      if (!p || !p.id) continue;
      const e = {};
      let any = false;
      for (const f of PRESERVED_FIELDS) {
        if (!isDefaultValue(p[f], f)) { e[f] = p[f]; any = true; }
      }
      if (!emptyConsumed(p.extra?.consumed_by)) { e.consumed_by = p.extra.consumed_by; any = true; }
      if (any) map.set(p.id, e);
    }
    return map;
  } catch {
    return new Map();
  }
}

function main() {
  if (!existsSync(RAW_PATH)) {
    console.warn(`[filter-apis] WARN: ${RAW_PATH} missing; nothing to filter. Exiting 0.`);
    process.exit(0);
  }
  console.log('=== ClaudeAtlas API Filter ===');
  // Substitution 1: raw is keyed by source:source_id (ids collide across sources pre-merge).
  const raw = [...readNdjsonRecords(RAW_PATH, { keyFn: rawKey }).values()];
  console.log(`Raw api records: ${raw.length}`);

  let by;
  try {
    by = preflight(raw);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`by_source: ${SOURCES.map((s) => `${s}=${by[s]}`).join(' ')}`);

  const prior = loadPriorEnrichments();
  const { records, tiers, stats } = filterApisRaw(raw, prior);

  console.log(`APIs after merge: ${stats.total_merged}`);
  console.log(`APIs after filter: ${records.length}`);
  console.log(`Tiers: ${tiers.featured} Featured, ${tiers.solid} Solid, ${tiers.listed} Listed`);
  console.log(`Merged duplicates: cross=${stats.merged_duplicates.cross_source} same=${stats.merged_duplicates.same_source}`);
  console.log(`Id collisions: ${stats.id_collisions}`);
  console.log(`Dropped: ${JSON.stringify(stats.dropped)}`);

  writeNdjsonStreaming(OUTPUT_PATH, records, { header: buildHeader('api') });
  console.log(`Written to ${OUTPUT_PATH} (schema_version=2; entity_type=api)`);

  // Merge api stats into pipeline-stats.json WITHOUT clobbering other sections.
  // dropped_names stay OUT of the committed sidecar (the calibration report recomputes them).
  let statsObj = {};
  if (existsSync(STATS_PATH)) {
    try { statsObj = JSON.parse(readFileSync(STATS_PATH, 'utf-8')); } catch { statsObj = {}; }
  }
  const { dropped_names, ...apiStats } = stats;
  void dropped_names;
  statsObj.api = { timestamp: new Date().toISOString(), ...apiStats };
  writeFileSync(STATS_PATH, JSON.stringify(statsObj, null, 2), 'utf-8');
}

const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();
