#!/usr/bin/env node
/**
 * scripts/snapshot-catalog.js — versioned catalog composition snapshot.
 *
 * Emits one small, committed JSON file per day at
 * `data/snapshots/<YYYY-MM-DD>.json` describing the *composition* of the
 * catalog on that day: how many records exist, how many are indexed
 * (non-duplicate), the tier mix, the per-entity-type breakdown, and the
 * category distribution. Unlike `data/history/<date>.json` (per-repo star
 * pulse), this snapshot is entity-level and tier-level — it is the raw
 * substrate the future `/trends` page and downstream AEO trend consumers
 * read to chart "what the catalog looked like over time".
 *
 * It is intentionally a *bounded* sidecar: the output is a handful of
 * counters (tiers × 3, entity types × ~3, categories × ~20), a few KB
 * regardless of catalog size. It reads the (large, gitignored) NDJSON
 * catalog files via the chunked `readNdjsonRecords` helper — NEVER a
 * whole-file `readFileSync` on a `data/` file (CLAUDE.md "Pipeline
 * footguns"). The one bounded `JSON.stringify(snapshot, null, 2)` write is
 * allowlisted whole-file in scripts/check-banned-patterns.js.
 *
 * ── DECISION (documented for AEO trend consumers) ──────────────────────
 * `totals.tiers` counts ALL records, INCLUDING duplicates (is_duplicate).
 * `totals.indexed` EXCLUDES duplicates. Therefore the tier mix will NOT
 * sum to `indexed` — it sums to `records`. This is deliberate: the tier
 * assignment is computed over the full catalog (duplicates carry a tier
 * too), and consumers charting "tier composition of everything scored"
 * want the full denominator, while consumers charting "what a user can
 * actually browse" want `indexed`. Both are provided; do not assume
 * `featured + solid + listed === indexed`.
 * `categories` is counted over INDEXED records only (duplicates would
 * double-count a canonical's category).
 * ───────────────────────────────────────────────────────────────────────
 *
 * Runs in the daily cron AFTER enrichment (so is_duplicate / tier values
 * are fresh) and BEFORE the Astro build. Purely additive: writes one new
 * file, touches no scoring/filter/render code.
 */

import { existsSync, openSync, writeSync, closeSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNdjsonRecords } from './lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Catalog NDJSON inputs. Each is optional — a missing file (e.g. plugins
// disabled, or MCP corpus not yet scraped) contributes zero records.
// Order is stable for deterministic aggregation.
const CATALOG_FILES = [
  join(ROOT, 'data', 'skills.ndjson'),
  join(ROOT, 'data', 'plugins.ndjson'),
  join(ROOT, 'data', 'mcp-servers.ndjson'),
];

// Canonical entity types always present in the output (stable time-series
// keys even when a corpus is empty on a given day).
const CANONICAL_ENTITY_TYPES = ['skill', 'plugin', 'mcp_server'];
const KNOWN_TIERS = ['featured', 'solid', 'listed'];

const SCHEMA_VERSION = 1;

function emptyTierCounts() {
  const t = {};
  for (const tier of KNOWN_TIERS) t[tier] = 0;
  return t;
}

function emptyTypeBucket() {
  return { records: 0, indexed: 0, duplicates: 0, tiers: emptyTierCounts() };
}

/**
 * Aggregate an iterable of EntityRecords into a composition snapshot.
 *
 * Pure: no I/O, no clock read beyond what the caller passes in `opts`.
 * Robust to legacy / partially-enriched records:
 *   - `entity_type` missing  → treated as 'skill'
 *   - `is_duplicate` missing/null/false → treated as NOT a duplicate
 *     (mirrors the site's "degrade to show-everything on null" contract)
 *   - `quality_tier` missing → not counted in any tier bucket (records
 *     total still increments)
 *
 * @param {Iterable<any>} records
 * @param {{ date?: string, generatedAt?: string }} [opts]
 * @returns {object} snapshot
 */
export function aggregateSnapshot(records, opts = {}) {
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const date = opts.date || generatedAt.slice(0, 10);

  const totals = {
    records: 0,
    indexed: 0,
    duplicates: 0,
    tiers: emptyTierCounts(), // ALL records incl. duplicates — see header DECISION
  };

  const byType = {};
  for (const et of CANONICAL_ENTITY_TYPES) byType[et] = emptyTypeBucket();

  const categories = {}; // counted over INDEXED records only

  for (const rec of records) {
    if (!rec || rec._header === true) continue;

    const et = rec.entity_type || 'skill';
    if (!byType[et]) byType[et] = emptyTypeBucket();
    const bucket = byType[et];

    const isDup = rec.is_duplicate === true;
    const tier = rec.quality_tier;

    totals.records += 1;
    bucket.records += 1;

    if (isDup) {
      totals.duplicates += 1;
      bucket.duplicates += 1;
    } else {
      totals.indexed += 1;
      bucket.indexed += 1;
    }

    // Tier counts include duplicates (full-catalog denominator).
    if (tier && Object.prototype.hasOwnProperty.call(totals.tiers, tier)) {
      totals.tiers[tier] += 1;
      bucket.tiers[tier] += 1;
    } else if (tier) {
      // Unexpected tier value — surface it rather than silently drop.
      totals.tiers[tier] = (totals.tiers[tier] || 0) + 1;
      bucket.tiers[tier] = (bucket.tiers[tier] || 0) + 1;
    }

    // Category distribution over indexed records, derived from
    // `category:<slug>` tags (the primary classifier per the data model).
    if (!isDup && Array.isArray(rec.tags)) {
      for (const t of rec.tags) {
        if (typeof t === 'string' && t.startsWith('category:')) {
          const slug = t.slice('category:'.length);
          if (slug) categories[slug] = (categories[slug] || 0) + 1;
        }
      }
    }
  }

  // Sort categories by count desc (then slug asc) for stable, readable output.
  const sortedCategories = {};
  for (const [slug, count] of Object.entries(categories).sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )) {
    sortedCategories[slug] = count;
  }

  return {
    schema_version: SCHEMA_VERSION,
    date,
    generated_at: generatedAt,
    totals,
    by_entity_type: byType,
    categories: sortedCategories,
  };
}

/**
 * Read all catalog NDJSON inputs into a single flat array of records.
 * Missing files contribute nothing (readNdjsonRecords returns an empty Map).
 *
 * @param {string[]} [files]
 * @returns {any[]}
 */
export function loadCatalogRecords(files = CATALOG_FILES) {
  const all = [];
  for (const f of files) {
    const map = readNdjsonRecords(f);
    for (const rec of map.values()) all.push(rec);
  }
  return all;
}

/**
 * Atomic-ish JSON write with EPERM tolerance (Windows AV / file-locking
 * defensiveness; a no-op cost on CI/POSIX). The snapshot is a small
 * bounded object, so tmp+rename is cheap.
 *
 * @param {string} path
 * @param {object} obj
 */
function writeJsonAtomic(path, obj) {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = path + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(obj, null, 2) + '\n');
  } finally {
    closeSync(fd);
  }
  renameWithRetry(tmp, path);
}

function renameWithRetry(src, dst, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      renameSync(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'EBUSY') throw err;
      const until = Date.now() + 50 * (attempt + 1);
      while (Date.now() < until) { /* brief spin — AV typically releases within ~50ms */ }
    }
  }
  try {
    if (existsSync(dst)) unlinkSync(dst);
    renameSync(src, dst);
  } catch {
    throw lastErr;
  }
}

/**
 * Build today's snapshot from the on-disk catalog and write it to
 * `data/snapshots/<date>.json`. Returns the snapshot object.
 *
 * @param {{ rootDir?: string, now?: Date }} [opts]
 * @returns {object}
 */
export function buildAndWriteSnapshot(opts = {}) {
  const rootDir = opts.rootDir || ROOT;
  const now = opts.now || new Date();
  const generatedAt = now.toISOString();
  const date = generatedAt.slice(0, 10);

  const files = [
    join(rootDir, 'data', 'skills.ndjson'),
    join(rootDir, 'data', 'plugins.ndjson'),
    join(rootDir, 'data', 'mcp-servers.ndjson'),
  ];
  const records = loadCatalogRecords(files);
  const snapshot = aggregateSnapshot(records, { date, generatedAt });

  const outPath = join(rootDir, 'data', 'snapshots', `${date}.json`);
  writeJsonAtomic(outPath, snapshot);

  console.log(
    `[snapshot-catalog] ${date}: ${snapshot.totals.records} records ` +
    `(${snapshot.totals.indexed} indexed, ${snapshot.totals.duplicates} dup) → ` +
    `${join('data', 'snapshots', `${date}.json`)}`,
  );
  for (const et of Object.keys(snapshot.by_entity_type)) {
    const b = snapshot.by_entity_type[et];
    console.log(`  ${et}: ${b.records} records, ${b.indexed} indexed`);
  }
  return snapshot;
}

export function main() {
  buildAndWriteSnapshot();
}

// Only run main() when invoked as a script, not when imported by tests.
// Mirrors the filter.js invoked-as-script guard idiom.
const invokedAsScript = (() => {
  try {
    return import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/')
      || fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  main();
}
