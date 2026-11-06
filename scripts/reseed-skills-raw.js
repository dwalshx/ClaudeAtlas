#!/usr/bin/env node
/**
 * ClaudeAtlas — rebuild data/skills-raw.ndjson from release assets.
 *
 * Disaster-recovery tool for the outage of 2026-09-28 → 2026-11-05
 * (.planning/debug/daily-scrape-outage-2026-09-28.md): every
 * `skills-raw-ndjson-*` GHA cache key became a ~200-byte placeholder and the
 * only surviving copies of the corpus are
 *
 *   PRIMARY   `skills-latest` release asset  — the last published catalog
 *             (~101k v2 EntityRecords, 2026-09-27). filter.js's upcastRecord
 *             passes v2 records through, and Track 2's unchanged-skip uses the
 *             top-level `content_sha`, so these records are a valid raw seed.
 *   SECONDARY `skills-raw-ndjson-bootstrap` release asset — the May 2026 raw
 *             corpus (33k v1 records). Adds back records that filter had
 *             dropped from the catalog but Track 2 would still skip-by-sha.
 *
 * Merge rule: union by `id`; PRIMARY wins on collision (fresher). Output is
 * header-less NDJSON, exactly what scrape-discover-repos.js writes.
 *
 * Usage:
 *   node scripts/reseed-skills-raw.js --primary <ndjson> [--secondary <ndjson>] --output <ndjson>
 *
 * Driven by .github/workflows/reseed-skills-raw.yml. Pure merge helper
 * `mergeById` is exported for tests.
 */

import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { readNdjsonRecords, writeNdjsonStreaming } from './lib/ndjson.js';

function parseArgs(argv) {
  const out = { primary: null, secondary: null, output: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--primary') out.primary = argv[++i];
    else if (a === '--secondary') out.secondary = argv[++i];
    else if (a === '--output') out.output = argv[++i];
    else if (a.startsWith('--primary=')) out.primary = a.slice('--primary='.length);
    else if (a.startsWith('--secondary=')) out.secondary = a.slice('--secondary='.length);
    else if (a.startsWith('--output=')) out.output = a.slice('--output='.length);
  }
  return out;
}

function log(msg) { console.log(`[reseed] ${msg}`); }

/**
 * Pure: union of two id-keyed Maps; `primary` wins on collision.
 * Returns { merged: Map, fromPrimary, fromSecondary, collisions }.
 */
export function mergeById(primary, secondary = new Map()) {
  const merged = new Map();
  let collisions = 0;
  for (const [id, rec] of secondary) merged.set(id, rec);
  for (const [id, rec] of primary) {
    if (merged.has(id)) collisions++;
    merged.set(id, rec);
  }
  return {
    merged,
    fromPrimary: primary.size,
    fromSecondary: merged.size - primary.size,
    collisions,
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.primary || !args.output) {
    console.error('usage: node scripts/reseed-skills-raw.js --primary <ndjson> [--secondary <ndjson>] --output <ndjson>');
    process.exit(2);
  }
  if (!existsSync(args.primary)) {
    console.error(`[reseed] FATAL: primary ${args.primary} not found`);
    process.exit(1);
  }
  log(`primary:   ${args.primary}`);
  const primary = readNdjsonRecords(args.primary, { keyFn: (r) => r.id });
  log(`primary records: ${primary.size}`);

  let secondary = new Map();
  if (args.secondary) {
    if (!existsSync(args.secondary)) {
      console.error(`[reseed] FATAL: secondary ${args.secondary} not found`);
      process.exit(1);
    }
    log(`secondary: ${args.secondary}`);
    secondary = readNdjsonRecords(args.secondary, { keyFn: (r) => r.id });
    log(`secondary records: ${secondary.size}`);
  }

  const { merged, fromPrimary, fromSecondary, collisions } = mergeById(primary, secondary);
  if (merged.size === 0) {
    console.error('[reseed] FATAL: merged corpus is empty — refusing to write');
    process.exit(1);
  }

  // Match scrape-discover-repos.js's on-disk order (quality_score desc).
  const records = [...merged.values()].sort((a, b) => (b.quality_score || 0) - (a.quality_score || 0));
  writeNdjsonStreaming(args.output, records);
  log(`wrote ${args.output}: ${records.length} records (${fromPrimary} from primary, ${fromSecondary} added from secondary, ${collisions} collisions resolved to primary)`);
}

const invokedAsScript = (() => {
  try {
    return fileURLToPath(import.meta.url) === process.argv[1]
      || (process.argv[1] || '').endsWith('reseed-skills-raw.js');
  } catch {
    return false;
  }
})();

if (invokedAsScript) {
  main().catch((err) => {
    console.error(`[reseed] FATAL: ${err.stack || err.message}`);
    process.exit(1);
  });
}
