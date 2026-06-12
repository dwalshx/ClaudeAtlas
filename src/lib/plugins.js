/**
 * src/lib/plugins.js — Phase 3.3 plugin + MCP build-time loader.
 *
 * WHY THIS FILE EXISTS (RESEARCH Q3, Pitfall 1): `src/lib/entities.js`
 * `getEntitiesByType('plugin')` returns [] at build time because its
 * `allEntities` is built exclusively from `data/skills.ndjson` (skills-only
 * by construction — `resolveSkillsNdjsonPath()`). Plugins live in
 * `data/plugins.ndjson` and MCP servers in `data/mcp-servers.ndjson`; this
 * loader reads them directly, mirroring the verified
 * `scripts/generate-feeds.js loadExtraEntities()` precedent.
 *
 * Reads use the sanctioned streaming helper `readNdjsonRecords`
 * (scripts/lib/ndjson.js) — never materialize data/ files as one giant
 * string (CLAUDE.md "Pipeline footguns", V8 ~536 MB single-string ceiling).
 *
 * Bundle-graph resolution (RESEARCH Q4, Pitfall 3): `bundled_*` arrays carry
 * entity IDs, not slugs, so resolution goes through Map ID indexes:
 *   - plugin.extra.bundled_skills[]      → skill IDs (legacy-UNPREFIXED on
 *     disk, e.g. "<repo>/<path>/SKILL.md"; the typedef's `skill:` prefix is
 *     normalized away defensively)
 *   - plugin.extra.bundled_mcp_servers[] → "mcp_server:<repo>/<path>"
 *   - skill.bundled_in_plugins[]         → "plugin:<repo>/.claude-plugin/plugin.json"
 *     (reverse edge, D-10 — written by scripts/link-bundles.js)
 *
 * Pure build-time module — do NOT route any of this through the worker.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readNdjsonRecords } from '../../scripts/lib/ndjson.js';
import { allSkills } from './entities.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../data');

/**
 * Load an NDJSON data file into an array of records. Graceful empty when the
 * file is absent (pages render empty — matches loadExtraEntities semantics).
 *
 * @param {string} file
 * @returns {any[]}
 */
function load(file) {
  const p = join(DATA, file);
  if (!existsSync(p)) return [];
  return [...readNdjsonRecords(p, { keyFn: (r) => r.id }).values()];
}

const allPlugins = load('plugins.ndjson');
const allMcps = load('mcp-servers.ndjson');

// ID indexes for bundle-graph resolution (RESEARCH Q4). allSkills is the
// FULL catalog — every tier, pre-getStaticPaths filter — so bundled Listed
// skills resolve too (their cards link to KV-served pages).
const pluginById = new Map(allPlugins.map((p) => [p.id, p]));
const mcpById = new Map(allMcps.map((m) => [m.id, m]));
const skillById = new Map(allSkills.map((s) => [s.id, s]));

/** @returns {any[]} every plugin record (all tiers, duplicates included) */
export function getPlugins() {
  return allPlugins;
}

/** @returns {any[]} every MCP server record */
export function getMcpServers() {
  return allMcps;
}

/**
 * Resolve a plugin by slug. NO is_duplicate filter — direct-URL access must
 * resolve a duplicate's page (matches getSkillBySlug in entities.js).
 *
 * @param {string} slug
 * @returns {any | null}
 */
export function getPluginBySlug(slug) {
  if (!slug) return null;
  return allPlugins.find((p) => p.slug === slug) || null;
}

/**
 * Resolve an MCP server by slug (same no-filter contract as getPluginBySlug).
 *
 * @param {string} slug
 * @returns {any | null}
 */
export function getMcpBySlug(slug) {
  if (!slug) return null;
  return allMcps.find((m) => m.slug === slug) || null;
}

/**
 * Resolve `plugin.extra.bundled_skills[]` entity IDs to skill records.
 * Missing IDs are filtered (a bundled skill may have been dropped by the
 * skill filter since link-bundles ran); input order is preserved.
 *
 * On-disk skill IDs are legacy-unprefixed ("<repo>/<path>/SKILL.md") and
 * bundled_skills entries match them directly (data-verified). The typedef's
 * "skill:<...>" prefixed form is also accepted via normalization.
 *
 * @param {string[] | null | undefined} ids
 * @returns {any[]}
 */
export function resolveBundledSkills(ids) {
  return (ids || [])
    .map((id) => skillById.get(id) || skillById.get(String(id).replace(/^skill:/, '')))
    .filter(Boolean);
}

/**
 * Resolve `plugin.extra.bundled_mcp_servers[]` IDs ("mcp_server:<repo>/<path>")
 * to MCP records (for /mcp/<slug>/ links).
 *
 * @param {string[] | null | undefined} ids
 * @returns {any[]}
 */
export function resolveBundledMcps(ids) {
  return (ids || []).map((id) => mcpById.get(id)).filter(Boolean);
}

/**
 * Resolve `skill.bundled_in_plugins[]` IDs (reverse edge, D-10:
 * "plugin:<repo>/.claude-plugin/plugin.json") to plugin records, for the
 * "part of plugin X" links on skill pages.
 *
 * @param {string[] | null | undefined} ids
 * @returns {any[]}
 */
export function resolveBundledPlugins(ids) {
  return (ids || []).map((id) => pluginById.get(id)).filter(Boolean);
}

/**
 * Normalize a marketplace_listings entry. Plan-01+ records carry
 * {path, name|null}; legacy records (pre-3.3 pipeline output) carry bare
 * path strings. Both normalize to {path, name|null}.
 *
 * @param {string | {path?: string, name?: string|null} | null | undefined} entry
 * @returns {{path: string, name: string|null} | null}
 */
function normalizeListing(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { path: entry, name: null };
  if (typeof entry.path === 'string' && entry.path) {
    return { path: entry.path, name: entry.name || null };
  }
  return null;
}

/**
 * Derive the two-step marketplace install commands for a plugin (D-08,
 * RESEARCH Q1 — docs-verified flow):
 *   step 1: `/plugin marketplace add <owner/repo>`
 *   step 2: `/plugin install <plugin-name>@<declared-marketplace-name>`
 *
 * Pitfall 2: the step-2 token MUST use the marketplace manifest's declared
 * `name`, never `owner/repo` — `name@owner/repo` is the docs' #1 "plugin not
 * found in any marketplace" failure. When the declared name is unknown
 * (legacy bare-string listing or name:null), installCmd is null and the UI
 * falls back to the GitHub CTA for step 2. githubFallback is always true:
 * every plugin page offers the repo link as the universal fallback.
 *
 * @param {any} plugin
 * @returns {{hasMarketplace: boolean, addCmd: string|null, installCmd: string|null, githubFallback: boolean}}
 */
export function installCommand(plugin) {
  const listings = plugin?.extra?.marketplace_listings || [];
  const listing = normalizeListing(listings[0]);
  return {
    hasMarketplace: Boolean(listing),
    addCmd: listing ? `/plugin marketplace add ${listing.path}` : null,
    installCmd:
      listing && listing.name ? `/plugin install ${plugin.name}@${listing.name}` : null,
    githubFallback: true,
  };
}
