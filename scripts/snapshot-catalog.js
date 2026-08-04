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
 * sum to `indexed` — it sums to `analyzed`. This is deliberate: the tier
 * assignment is computed over the full catalog (duplicates carry a tier
 * too), and consumers charting "tier composition of everything scored"
 * want the full denominator, while consumers charting "what a user can
 * actually browse" want `indexed`. Both are provided; do not assume
 * `featured + solid + listed === indexed`.
 * `by_category` is counted over INDEXED records only (duplicates would
 * double-count a canonical's category).
 *
 * ── EXTRA COMPOSITION FIELDS (quick-260804-d5p gap closure) ─────────────
 * `new_last_7d` counts records whose `scraped_at` parses to within 7 days
 * of the snapshot date (missing/unparseable scraped_at → NOT counted).
 * NOTE: `scraped_at` is the LAST-SCRAPE time, not a true first-seen
 * timestamp — a record re-touched by the scraper refreshes it — so
 * `new_last_7d` is a BEST-EFFORT GROWTH PROXY, not an exact "new records"
 * count.
 * `maintenance.{active,abandoned}` is computed over INDEXED records only
 * (consistent with `by_category`): active = `repo_pushed_at` within 90
 * days of the snapshot date; abandoned = everything else. A missing or
 * unparseable `repo_pushed_at` counts as abandoned (conservative).
 * `unique_creators` is the distinct-owner count (the `owner/…` prefix of
 * `repo_full_name`) over INDEXED records; records with no repo_full_name
 * are skipped.
 * `churn.archived` counts `repo_archived === true` over ALL analyzed
 * records; `churn.duplicates` counts `is_duplicate === true` and therefore
 * MIRRORS `totals.duplicates` exactly (surfaced here for a self-contained
 * churn view).
 * The snapshot-date reference for the 7d/90d windows is derived from the
 * `timestamp` opt (overridable via `opts.nowMs` for deterministic tests).
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
 * @param {{ date?: string, generatedAt?: string, nowMs?: number }} [opts]
 *   `nowMs` overrides the snapshot-date reference used for the 7d/90d
 *   windows (defaults to Date.parse(generatedAt)) — pass it for
 *   deterministic tests.
 * @returns {object} snapshot
 */
export function aggregateSnapshot(records, opts = {}) {
  const generatedAt = opts.generatedAt || new Date().toISOString();
  const date = opts.date || generatedAt.slice(0, 10);
  // Reference "now" for the growth (7d) / maintenance (90d) windows.
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.parse(generatedAt);
  const DAY_MS = 86400000;

  const totals = {
    analyzed: 0,
    indexed: 0,
    duplicates: 0,
    tiers: emptyTierCounts(), // ALL records incl. duplicates — see header DECISION
  };

  const byType = {};
  for (const et of CANONICAL_ENTITY_TYPES) byType[et] = emptyTypeBucket();

  const categories = {}; // counted over INDEXED records only

  // Extra composition accumulators (quick-260804-d5p gap closure).
  let newLast7d = 0;                 // scraped_at within 7d (ALL records)
  let maintActive = 0;               // repo_pushed_at within 90d (INDEXED only)
  let maintAbandoned = 0;            // older / missing / unparseable (INDEXED only)
  let archivedCount = 0;             // repo_archived === true (ALL records)
  const creators = new Set();        // distinct repo owners (INDEXED only)

  for (const rec of records) {
    if (!rec || rec._header === true) continue;

    const et = rec.entity_type || 'skill';
    if (!byType[et]) byType[et] = emptyTypeBucket();
    const bucket = byType[et];

    const isDup = rec.is_duplicate === true;
    const tier = rec.quality_tier;

    totals.analyzed += 1;
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

    // Churn: archived over ALL analyzed records.
    if (rec.repo_archived === true) archivedCount += 1;

    // Growth proxy: scraped_at within 7d over ALL analyzed records.
    // Missing / unparseable scraped_at is not counted.
    const scrapedMs = Date.parse(rec.scraped_at);
    if (Number.isFinite(scrapedMs) && nowMs - scrapedMs <= 7 * DAY_MS) {
      newLast7d += 1;
    }

    // Maintenance + creators over INDEXED (non-duplicate) records only.
    if (!isDup) {
      const pushedMs = Date.parse(rec.repo_pushed_at);
      if (Number.isFinite(pushedMs) && nowMs - pushedMs <= 90 * DAY_MS) {
        maintActive += 1;
      } else {
        // Missing / unparseable / >90d → abandoned (conservative).
        maintAbandoned += 1;
      }

      const owner =
        typeof rec.repo_full_name === 'string' ? rec.repo_full_name.split('/')[0] : '';
      if (owner) creators.add(owner);
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
    timestamp: generatedAt,
    totals,
    by_entity_type: byType,
    by_category: sortedCategories,
    new_last_7d: newLast7d,
    maintenance: { active: maintActive, abandoned: maintAbandoned },
    unique_creators: creators.size,
    churn: { archived: archivedCount, duplicates: totals.duplicates },
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
    `[snapshot-catalog] ${date}: ${snapshot.totals.analyzed} analyzed ` +
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
