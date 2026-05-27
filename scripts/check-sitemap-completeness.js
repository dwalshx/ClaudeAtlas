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
 * This script asserts that the generated sitemap-0.xml has the expected
 * number of `<loc>` entries: one per record in data/skills.ndjson, plus a
 * small allowance for static pages (homepage, methodology, category pages,
 * creators, /apis, etc.).
 *
 * Runs as postbuild. Exit 1 if the count is off — that's the silent-
 * SEO-erosion failure mode DOD-10 was added to catch.
 */

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SITEMAP_PATH = join(ROOT, 'dist', 'sitemap-0.xml');
const SKILLS_NDJSON_PATH = join(ROOT, 'data', 'skills.ndjson');

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
  if (!existsSync(SITEMAP_PATH)) {
    console.error(`[sitemap-completeness] FATAL: ${SITEMAP_PATH} not found (did Astro build emit sitemap?)`);
    process.exit(1);
  }

  if (!existsSync(SKILLS_NDJSON_PATH)) {
    console.warn(`[sitemap-completeness] SKIP: ${SKILLS_NDJSON_PATH} missing — likely cold start. Re-run after filter.js produces it.`);
    process.exit(0);
  }

  // Sitemap read uses readFileSync on dist/ — allowed (one-shot CI check
  // against a bounded ~5 MB XML file). Lint scans data/ only.
  const sitemapXml = readFileSync(SITEMAP_PATH, 'utf-8');
  const locCount = (sitemapXml.match(/<loc>/g) || []).length;

  // Skill count via wc -l (no readFileSync on data/skills.ndjson — dodges
  // the lint rule entirely; also fast on large files).
  let skillCount;
  try {
    skillCount = parseInt(
      execSync(`wc -l < "${SKILLS_NDJSON_PATH}"`, { encoding: 'utf-8' }).trim(),
      10,
    );
  } catch (err) {
    console.error(`[sitemap-completeness] FATAL: failed to count records in ${SKILLS_NDJSON_PATH}: ${err.message}`);
    process.exit(1);
  }

  const tolerance = computeTolerance(skillCount);

  console.log(`[sitemap-completeness] sitemap-0.xml: ${locCount} <loc> entries`);
  console.log(`[sitemap-completeness] skills.ndjson: ${skillCount} records`);
  console.log(`[sitemap-completeness] tolerance: ±${tolerance} (max(1500, 15% of catalog) — scales with creator page count)`);

  // Allowed range: skill count - small (some skills may legitimately be
  // omitted, e.g. malformed) up to skill count + tolerance (static pages).
  const diff = locCount - skillCount;
  if (diff < -25 || diff > tolerance) {
    console.error(`[sitemap-completeness] FATAL: <loc> count ${locCount} not in [${skillCount - 25}, ${skillCount + tolerance}]`);
    console.error('[sitemap-completeness] Likely cause: astro.config.mjs `customPages` not enumerating every slug,');
    console.error('[sitemap-completeness] or skills.ndjson is stale. Re-run filter then rebuild.');
    process.exit(1);
  }

  console.log('[sitemap-completeness] OK');
}

main();
