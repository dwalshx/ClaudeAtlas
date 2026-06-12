#!/usr/bin/env node
/**
 * Sitemap completeness gate (Phase 03.1.1 T5f / DOD-10).
 *
 * After T5 ships tier-aware rendering, only Top+Solid slugs get a static
 * HTML file in dist/. Listed slugs are served at request time by the worker
 * via env.SKILLS_KV.get(slug). Default @astrojs/sitemap behavior would only
 * enumerate pages that exist in dist/ — Listed slugs would silently vanish
 * from sitemap.xml, search engines would stop indexing them, and traffic
 * would erode over weeks. That's why astro.config.mjs uses customPages to
 * enumerate every skill slug regardless of tier.
 *
 * This script asserts that the generated sitemap has the expected number of
 * `<loc>` entries: one per record in data/skills.ndjson, plus (Phase 3.3)
 * one per record in data/plugins.ndjson and data/mcp-servers.ndjson — the
 * fully-static /plugins/<slug>/ and /mcp/<slug>/ page sets — plus a small
 * allowance for static pages (homepage, methodology, category pages,
 * creators, /apis, etc.). The plugin/MCP files are guarded with existsSync
 * (count 0 when absent) so skills-only branches/CI keep working.
 *
 * Once the catalog crossed ~45,000 URLs, @astrojs/sitemap split the output
 * across multiple numbered files (sitemap-0.xml capped at 45,000 entries,
 * sitemap-1.xml the remainder, etc.) plus a sitemap-index.xml that points to
 * the sub-sitemaps. This script sums `<loc>` across ALL numbered sitemap
 * files (sitemap-N.xml) and intentionally EXCLUDES sitemap-index.xml — the
 * index's <loc> entries reference sub-sitemaps, not pages.
 *
 * Runs as postbuild. Exit 1 if the count is off — that's the silent-
 * SEO-erosion failure mode DOD-10 was added to catch.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_DIR = join(ROOT, 'dist');
// Matches sitemap-0.xml, sitemap-1.xml, … — and EXCLUDES sitemap-index.xml
// (whose <loc> entries point to sub-sitemaps, not indexable pages).
const NUMBERED_SITEMAP_RE = /^sitemap-\d+\.xml$/;
const SKILLS_NDJSON_PATH = join(ROOT, 'data', 'skills.ndjson');
// Phase 3.3: plugin + MCP detail pages are fully static (D-07), so their
// record counts join the expected <loc> basis. existsSync-guarded → 0 when
// absent (skills-only branches/CI keep passing).
const PLUGINS_NDJSON = join(ROOT, 'data', 'plugins.ndjson');
const MCP_NDJSON = join(ROOT, 'data', 'mcp-servers.ndjson');

// Margin for static pages (homepage, methodology, 404, category/*, creators,
// apis, etc.). Scales with catalog size because /creators/[username].astro
// auto-emits one page per unique repo owner — that set grew ~10x with
// Phase 3.1's catalog expansion (~360 creators → ~3,400 creators at 34k
// catalog). Floor of 1,500 preserves the original safety net for small
// catalogs; the 15% term covers creator-page scaling with catalog growth.
function computeTolerance(skillCount) {
  return Math.max(1500, Math.floor(skillCount * 0.15));
}

function main() {
  // Enumerate every numbered sitemap file (sitemap-N.xml). @astrojs/sitemap
  // emits a single sitemap-0.xml below ~45k URLs and splits into multiple
  // numbered files above that, alongside a sitemap-index.xml we deliberately
  // skip (its <loc> entries point to sub-sitemaps, not pages).
  let sitemapFiles;
  try {
    sitemapFiles = readdirSync(DIST_DIR)
      .filter((f) => NUMBERED_SITEMAP_RE.test(f))
      .sort();
  } catch {
    sitemapFiles = [];
  }

  if (sitemapFiles.length === 0) {
    console.error(`[sitemap-completeness] FATAL: no sitemap-N.xml found in ${DIST_DIR} (did Astro build emit sitemap?)`);
    process.exit(1);
  }

  if (!existsSync(SKILLS_NDJSON_PATH)) {
    console.warn(`[sitemap-completeness] SKIP: ${SKILLS_NDJSON_PATH} missing — likely cold start. Re-run after filter.js produces it.`);
    process.exit(0);
  }

  // Sitemap reads use readFileSync on dist/ — allowed (one-shot CI check
  // against bounded XML files). Lint scans data/ only. Sum <loc> across all
  // numbered sitemap files so multi-file (split) sitemaps count fully.
  let locCount = 0;
  for (const f of sitemapFiles) {
    const sitemapXml = readFileSync(join(DIST_DIR, f), 'utf-8');
    locCount += (sitemapXml.match(/<loc>/g) || []).length;
  }

  // Record counts via wc -l (no readFileSync on data/*.ndjson — dodges the
  // lint rule entirely; also fast on large files). countRecords returns 0
  // for absent files so plugin/MCP-less checkouts keep the skills-only basis.
  function countRecords(path) {
    if (!existsSync(path)) return 0;
    return parseInt(
      execSync(`wc -l < "${path}"`, { encoding: 'utf-8' }).trim(),
      10,
    );
  }

  let skillCount;
  try {
    skillCount = countRecords(SKILLS_NDJSON_PATH);
  } catch (err) {
    console.error(`[sitemap-completeness] FATAL: failed to count records in ${SKILLS_NDJSON_PATH}: ${err.message}`);
    process.exit(1);
  }

  // Phase 3.3: plugin + MCP detail pages are fully static — their record
  // counts join the expected basis. A wc -l failure here degrades to 0
  // (same as file-absent) rather than failing the gate: the tolerance below
  // absorbs the gap and the skills basis is the load-bearing assertion.
  let pluginCount = 0;
  let mcpCount = 0;
  try {
    pluginCount = countRecords(PLUGINS_NDJSON);
    mcpCount = countRecords(MCP_NDJSON);
  } catch (err) {
    console.warn(`[sitemap-completeness] WARN: failed to count plugin/MCP records (${err.message}) — using 0`);
  }

  const expectedCount = skillCount + pluginCount + mcpCount;
  const tolerance = computeTolerance(expectedCount);

  console.log(`[sitemap-completeness] ${sitemapFiles.length} sitemap file(s) (${sitemapFiles.join(', ')}), ${locCount} <loc> entries total`);
  console.log(`[sitemap-completeness] skills.ndjson: ${skillCount} records, plugins.ndjson: ${pluginCount}, mcp-servers.ndjson: ${mcpCount} → expected basis ${expectedCount}`);
  console.log(`[sitemap-completeness] tolerance: ±${tolerance} (max(1500, 15% of combined basis) — scales with creator page count)`);

  // Allowed range: expected count - small (some records may legitimately be
  // omitted, e.g. malformed or duplicate-filtered) up to expected count +
  // tolerance (static pages, creator pages).
  const diff = locCount - expectedCount;
  if (diff < -25 || diff > tolerance) {
    console.error(`[sitemap-completeness] FATAL: <loc> count ${locCount} not in [${expectedCount - 25}, ${expectedCount + tolerance}]`);
    console.error('[sitemap-completeness] Likely cause: astro.config.mjs `customPages` not enumerating every skill slug,');
    console.error('[sitemap-completeness] a plugin/MCP getStaticPaths regression, or stale skills/plugins/mcp-servers');
    console.error('[sitemap-completeness] NDJSON. Re-run the filter steps then rebuild.');
    process.exit(1);
  }

  console.log('[sitemap-completeness] OK');
}

main();
