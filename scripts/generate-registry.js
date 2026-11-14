#!/usr/bin/env node

/**
 * ClaudeAtlas Machine-Readable Registry
 *
 * Build-time script that emits public/skills-registry.json — a compact,
 * agent-facing catalog of every indexed skill. Gets served at
 * https://claudeatlas.com/skills-registry.json after deploy.
 *
 * This is Phase 1.5's answer to the Phase 2 query API: a simple static
 * bulk file that any tool can fetch once and parse locally. Costs nothing
 * at the edge, caches forever (content-addressed-ish via daily rebuilds).
 *
 * Phase 4.1: `buildRegistryEntry` is exported and `main()` is guarded by
 * `invokedAsScript` so the round-trip test can exercise the registry leg
 * without `data/skills.ndjson`. CLI behaviour unchanged. Registry content
 * is still skills-only (`loadSkillsArray`).
 *
 * Phase 4.3: the registry stays skills-only by design (plugins / MCP servers
 * are not listed here either). When data/apis.ndjson ships with the build, an
 * additive top-level `apis` summary block points agents at the API index,
 * type-filtered search and the `apis-latest` NDJSON release asset. The key is
 * omitted entirely when the build has no api records (flag off).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { loadSkillsArray } from './lib/skills-stream.js';
import {
  summarizeApiCatalog,
  APIS_INDEX_URL,
  APIS_DETAIL_URL_TEMPLATE,
  APIS_SEARCH_URL,
  APIS_BULK_DOWNLOAD_URL,
  APIS_METHODOLOGY_URL,
} from './lib/api-catalog-summary.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DATA_DIR = join(ROOT, 'data');
// T5: NDJSON. Reads use loadSkillsArray() (handles legacy fallback).
const SKILLS_PATH = join(DATA_DIR, 'skills.ndjson');
const STATS_PATH = join(DATA_DIR, 'pipeline-stats.json');
const PUBLIC_DIR = join(ROOT, 'public');
const OUTPUT_PATH = join(PUBLIC_DIR, 'skills-registry.json');

const API_GRAPH_PATH = join(DATA_DIR, 'api-graph.json');
const APIS_PATH = join(DATA_DIR, 'apis.ndjson');
const SITE_URL = 'https://claudeatlas.com';

function log(msg) {
  console.log(`[registry] ${msg}`);
}

/**
 * Build one registry entry from an entity record. Pure; exported for the
 * Phase 4.1 round-trip test. For skills (always a non-empty repo_full_name)
 * the output is byte-identical to the pre-4.1 inline map; null-repo feeds
 * get `install_command: null` instead of the string "claude install-skill null".
 *
 * @param {object} s
 * @param {{ skill_integrations?: Record<string, string[]> }} [apiGraph]
 */
export function buildRegistryEntry(s, apiGraph = { skill_integrations: {} }) {
  return {
    name: s.name,
    slug: s.slug,
    description: s.description || null,
    category: s.category,
    quality_tier: s.quality_tier,
    quality_score: s.quality_score,
    install_command: s.repo_full_name ? `claude install-skill ${s.repo_full_name}` : null,
    repo_full_name: s.repo_full_name,
    repo_url: s.repo_url,
    repo_stars: s.repo_stars || 0,
    repo_license: s.repo_license || null,
    repo_pushed_at: s.repo_pushed_at || null,
    // F2: prefer entity.extra.skill_first_commit_at (v2); fall back to legacy.
    skill_first_commit_at: (s.extra && s.extra.skill_first_commit_at) || s.skill_first_commit_at || null,
    integrations: apiGraph.skill_integrations?.[s.slug] || [],
    detail_url: `${SITE_URL}/skills/${s.slug}/`,
    badge_url: `${SITE_URL}/badge/${s.slug}.svg`,
    star_history_url: `${SITE_URL}/badge/${s.slug}-history.svg`,
    integrations_url: `${SITE_URL}/apis/`,
  };
}

/**
 * Phase 4.3: the additive `apis` summary block. Pure; returns null when the
 * build ships no api records (callers then omit the key).
 *
 * @param {{ count: number, tiers: { featured: number, solid: number, listed: number } } | null} apiSummary
 */
export function buildApisBlock(apiSummary) {
  if (!apiSummary || !(apiSummary.count > 0)) return null;
  const t = apiSummary.tiers || {};
  return {
    count: apiSummary.count,
    total_featured: t.featured || 0,
    total_solid: t.solid || 0,
    total_listed: t.listed || 0,
    index_url: APIS_INDEX_URL,
    detail_url_template: APIS_DETAIL_URL_TEMPLATE,
    search_api_url: APIS_SEARCH_URL,
    bulk_download_url: APIS_BULK_DOWNLOAD_URL,
    methodology_url: APIS_METHODOLOGY_URL,
    note: 'API records are not listed inline. Fetch the full catalog as NDJSON from `bulk_download_url` (one EntityRecord per line, entity_type "api", with the `access` block and per-field provenance) or query `search_api_url`.',
  };
}

export function main() {
  log('=== registry generator start ===');

  // T5: loadSkillsArray() handles NDJSON + legacy fallback.
  let skills;
  try {
    skills = loadSkillsArray();
  } catch (err) {
    console.error(`[registry] ERROR: ${err.message}`);
    process.exit(1);
  }

  // Load API graph for integrations enrichment
  let apiGraph = { skill_integrations: {} };
  if (existsSync(API_GRAPH_PATH)) {
    try {
      apiGraph = JSON.parse(readFileSync(API_GRAPH_PATH, 'utf-8'));
    } catch {}
  }

  let stats = {};
  if (existsSync(STATS_PATH)) {
    try {
      stats = JSON.parse(readFileSync(STATS_PATH, 'utf-8'));
    } catch {
      stats = {};
    }
  }

  const totalFeatured = skills.filter(s => s.quality_tier === 'featured').length;
  const totalSolid = skills.filter(s => s.quality_tier === 'solid').length;
  const totalListed = skills.filter(s => s.quality_tier === 'listed').length;

  // Phase 3.1.x: registry is filtered to renderable tiers (Featured + Solid)
  // because the full ~35k+ catalog produces a ~35MB JSON file that exceeds
  // Cloudflare Workers Static Assets' 25 MB per-asset cap. Listed-tier records
  // are discoverable via /api/v1/search (semantic search), via /browse (flat
  // anchor list), or by downloading the full skills.ndjson from the
  // skills-latest GitHub release asset (`bulk_download_url` below). The
  // registry remains the canonical "agents fetch one file, parse, done"
  // surface for the curated subset; full-catalog consumers have a clear path.
  // Future: Phase 3.x sharding (/skills-registry/{a,b,c}.json) once catalog
  // grows past ~14k renderable.
  const renderableEntries = skills.filter(s => s.quality_tier === 'featured' || s.quality_tier === 'solid');

  const entries = renderableEntries.map((s) => buildRegistryEntry(s, apiGraph));

  const apisBlock = buildApisBlock(summarizeApiCatalog(APIS_PATH));

  const registry = {
    name: 'ClaudeAtlas',
    url: SITE_URL,
    methodology_url: `${SITE_URL}/methodology/`,
    generated_at: new Date().toISOString(),
    // Phase 3.1.3 (Agent Hub): top-level citation block so any agent
    // that pulls the registry can surface attribution without a second
    // round-trip. Matches the citation spec in public/llms.txt and the
    // `source` field returned by /api/v1/search.
    citation: {
      source: 'ClaudeAtlas',
      source_url: SITE_URL,
      license: 'MIT (catalog metadata); skills retain upstream licenses',
      data_recency: 'Updated daily ~06:30 UTC',
      methodology_url: `${SITE_URL}/methodology/`,
      citation_url: `${SITE_URL}/credits/`,
      recommended_citation: 'Source: ClaudeAtlas — https://claudeatlas.com',
    },
    count: entries.length,
    // Phase 3.1.x: catalog totals reflect FULL catalog; `count` reflects
    // the renderable subset actually included in `skills` below.
    catalog_total: skills.length,
    subset: 'renderable',
    subset_note: 'This file contains only Featured + Solid tier skills (~14k records). The full catalog (~35k including Listed tier) is available via /api/v1/search (semantic) or the GitHub release at `bulk_download_url` (NDJSON, one record per line).',
    bulk_download_url: 'https://github.com/dwalshx/ClaudeAtlas/releases/download/skills-latest/skills.ndjson',
    search_api_url: `${SITE_URL}/api/v1/search`,
    browse_url: `${SITE_URL}/browse/`,
    total_discovered: stats.total_discovered || skills.length,
    total_featured: totalFeatured,
    total_solid: totalSolid,
    total_listed: totalListed,
    categories: [...new Set(entries.map(e => e.category))].sort(),
    schema_version: '3',
    schema_notes: 'Phase 3.1.3 — added top-level `citation` block (Agent Hub). Phase 3.1.x — filtered to renderable tiers due to 25MB asset cap. Full catalog via /api/v1/search or bulk_download_url. Phase 4.3 — optional top-level `apis` summary block (present only when the build ships API records).',
    ...(apisBlock ? { apis: apisBlock } : {}),
    skills: entries,
  };
  log(apisBlock ? `apis block: ${apisBlock.count.toLocaleString()} api records` : 'apis block: omitted (no api records on this build)');

  if (!existsSync(PUBLIC_DIR)) mkdirSync(PUBLIC_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(registry), 'utf-8');

  const size = JSON.stringify(registry).length;
  log(`wrote ${OUTPUT_PATH} (${entries.length} of ${skills.length} skills, ${(size / 1024).toFixed(1)} KB)`);
  // Defense in depth: hard-fail if we trip the 25MB Cloudflare cap. The
  // tier filter above SHOULD keep us under, but if catalog growth or a
  // tier-distribution shift pushes us over, fail fast at build time
  // rather than at wrangler deploy time (which produced two failed
  // production runs on 2026-05-27 before this guard was added).
  const CF_ASSET_CAP_BYTES = 25 * 1024 * 1024;
  if (size >= CF_ASSET_CAP_BYTES) {
    console.error(`[registry] FATAL: ${OUTPUT_PATH} is ${(size / 1024 / 1024).toFixed(1)} MB; Cloudflare Static Assets cap is 25 MB.`);
    console.error('[registry] Tighten the tier filter, shard the registry, or move to a Worker route.');
    process.exit(1);
  }
  log('=== registry generator complete ===');
}

// Only run main() when invoked as a script, not when imported by tests.
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) main();
