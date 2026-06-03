#!/usr/bin/env node

/**
 * scripts/filter-mcps.js — Phase 3.2 MCP filter (D-04, D-05).
 *
 * Reads the SAME data/plugins-raw.ndjson repo-level file as
 * filter-plugins.js, but dispatches on repos that carry MCP servers.
 *
 * F-1 DEVIATION: the plan assumed entity-tagged `entity_type:mcp_server`
 * records. Reality (observed 2026-05-31): MCP servers are NESTED COMPONENTS
 * of plugin repos, surfaced via `component_summary.mcp_servers > 0` and
 * `components["mcp-servers"].entries[]`. This script therefore DERIVES one
 * mcp_server EntityRecord per mcp-servers component entry, rather than
 * reading pre-tagged records.
 *
 * F-2 PRE-FLIGHT (adapted): the plan asserted >= 30 tagged mcp_server lines.
 * Reality is ~23 repos with mcp_servers > 0 (the assumed count was stale).
 * The pre-flight now counts repos with component_summary.mcp_servers > 0 and
 * uses a reality-based floor (MIN_MCP_REPOS) so a silent zero-record run
 * still fails loudly, while not spuriously failing on the true catalog size.
 *
 * Tier assignment uses the SHARED helper (D-04: uniform 10/30/60, NO
 * small-N carve-out — at N=38 → 3 Featured / 11 Solid / 24 Listed, accepted).
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
const OUTPUT_PATH = join(ROOT, 'data', 'mcp-servers.ndjson');
const STATS_PATH = join(ROOT, 'data', 'pipeline-stats.json');

const README_TRIM = 1500;
// F-2 (adapted): reality-based floor; the observed catalog has ~23 repos
// with mcp_servers > 0. Set the floor below that so the pre-flight still
// catches a 0-record drift without spuriously failing.
const MIN_MCP_REPOS = 10;

const PRESERVED_FIELDS = [
  'is_duplicate',
  'canonical_id',
  'canonical_slug',
  'novelty_score',
  'bundled_in_plugins',
];

/** Count repos that contain at least one MCP server (pre-flight). */
export function countMcpRepos(raw) {
  return raw.filter((r) => (r?.component_summary?.mcp_servers || 0) > 0).length;
}

/** The mcp-servers component entries of a repo (handles key variants). */
function mcpComponentEntries(raw) {
  const section = raw?.components?.['mcp-servers'] || raw?.components?.mcp_servers;
  if (!section || !Array.isArray(section.entries)) return [];
  return section.entries;
}

/**
 * Derive mcp_server EntityRecords from one repo-level raw record (one per
 * mcp-servers component entry). Returns pre-v2 tagged entities (upcaster
 * nests + fills defaults downstream).
 *
 * @param {any} raw
 * @param {{ readme?: string }} [opts]
 * @returns {any[]}
 */
export function repoToMcpEntities(raw, opts = {}) {
  const entries = mcpComponentEntries(raw);
  const manifest = (raw.plugin_manifest && typeof raw.plugin_manifest === 'object')
    ? raw.plugin_manifest : {};
  return entries.map((entry) => {
    const serverPath = entry.path || `mcp-servers/${entry.name || ''}`;
    return {
      entity_type: 'mcp_server',
      name: entry.name || serverPath.split('/').pop() || '',
      description: raw.description || manifest.description || '',
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
      discovery_signals: ['mcp'],
      repo_default_branch: raw.default_branch ?? null,
      extra: {
        type: 'mcp_server',
        server_path: serverPath,
        manifest: {},
        readme_markdown: opts.readme || '',
        // Tools cannot be enumerated from the discovery tree; default to the
        // server name as a single declared tool so a real MCP passes the
        // tools>=1 gate. Refined when scrape-plugins.js parses server config.
        tools: entry.name ? [entry.name] : [],
        transport: 'stdio', // default declared transport for filesystem MCPs
      },
    };
  });
}

function applyTags(entity) {
  const category = categorizeSkill(entity);
  entity.category = category;
  const categoryTags = mergeTags(deriveTagsFromLegacyCategory(category));
  const existing = Array.isArray(entity.tags) ? entity.tags.filter((t) => typeof t === 'string') : [];
  entity.tags = categoryTags.concat(existing.filter((t) => !categoryTags.includes(t)));
  if (!entity.category) entity.category = projectCategoryFromTags(entity.tags);
}

/**
 * Pure in-memory MCP filter pipeline (exported for tests).
 *
 * @param {Array<any>} raw  repo-level raw records.
 * @param {Map<string, object>} [priorEnrichments]
 * @param {{ readme?: string }} [opts]
 * @returns {{ records: any[], tiers: {featured:number,solid:number,listed:number} }}
 */
export function filterMcpsRaw(raw, priorEnrichments = new Map(), opts = {}) {
  let records = raw
    .filter((r) => (r?.component_summary?.mcp_servers || 0) > 0)
    .flatMap((r) => repoToMcpEntities(r, opts))
    .map(upcastRecord);

  for (const e of records) applyTags(e);
  records = records.filter((e) => !isSlop(e));

  for (const e of records) e.quality_score = scoreEntity(e);

  // D-04: Uniform 10/30/60 tier split. NO small-N carve-out. At N=38 MCPs
  // this produces 3 Featured; accepted.
  assignPercentileTiers(records);

  assignSlugs(records);

  for (const e of records) {
    if (e.extra && typeof e.extra.readme_markdown === 'string'
        && e.extra.readme_markdown.length > README_TRIM) {
      e.extra.readme_markdown = e.extra.readme_markdown.substring(0, README_TRIM) + '...';
    }
  }

  for (const e of records) {
    const prior = priorEnrichments.get(e.id);
    if (!prior) continue;
    for (const field of PRESERVED_FIELDS) {
      if (prior[field] == null) continue;
      const cur = e[field];
      const isDefault = cur == null || cur === false || (Array.isArray(cur) && cur.length === 0);
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
    console.warn(`[filter-mcps] WARN: ${RAW_PATH} missing; nothing to filter. Exiting 0.`);
    process.exit(0);
  }
  console.log('=== ClaudeAtlas MCP Filter ===');
  const raw = [...readNdjsonRecords(RAW_PATH, { keyFn: (r) => r.repo_full_name }).values()];

  // F-2 pre-flight (adapted): fail loudly on a silent zero-record run.
  const mcpRepos = countMcpRepos(raw);
  console.log(`Repos with mcp_servers > 0: ${mcpRepos}`);
  if (mcpRepos < MIN_MCP_REPOS) {
    console.error(
      `[filter-mcps] FATAL: only ${mcpRepos} repos with component_summary.mcp_servers > 0 ` +
      `(expected >= ${MIN_MCP_REPOS}). Check scrape-plugins.js component-detection logic ` +
      `(components["mcp-servers"] / component_summary.mcp_servers).`,
    );
    process.exit(1);
  }

  const prior = loadPriorEnrichments();
  const { records, tiers } = filterMcpsRaw(raw, prior);

  console.log(`MCP servers after filter: ${records.length}`);
  console.log(`Tiers: ${tiers.featured} Featured, ${tiers.solid} Solid, ${tiers.listed} Listed`);

  writeNdjsonStreaming(OUTPUT_PATH, records, { header: buildHeader('mcp_server') });
  console.log(`Written to ${OUTPUT_PATH} (schema_version=2; entity_type=mcp_server)`);

  let stats = {};
  if (existsSync(STATS_PATH)) {
    try { stats = JSON.parse(readFileSync(STATS_PATH, 'utf-8')); } catch { stats = {}; }
  }
  stats.mcp_server = {
    timestamp: new Date().toISOString(),
    total_raw_repos: raw.length,
    mcp_repos: mcpRepos,
    total_mcp_servers: records.length,
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
