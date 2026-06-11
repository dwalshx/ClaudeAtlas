#!/usr/bin/env node

/**
 * ClaudeAtlas Similar-Skills Pre-Computation
 *
 * Reads data/skill-vectors.ndjson (the embedding cache) and computes the top-K
 * most similar skills for each skill using cosine similarity. Writes the
 * results to data/similar-skills.json.
 *
 * This runs at build time (before Astro) so detail pages can render a
 * "Similar Skills" section without any client-side vector math or API calls.
 *
 * Algorithm (Phase 3.2.1):
 *   Normalize each vector to unit length (Float32) and retrieve the top-K
 *   neighbors per skill via scripts/lib/ann.js topKNeighbors — HNSW when the
 *   native engine is available (CI/cron), exact Float32 brute-force fallback
 *   otherwise (dev box). Self excluded; dot on unit vectors == cosine.
 *
 * Output shape:
 *   {
 *     "generated_at": "ISO 8601",
 *     "count": 1078,
 *     "similar": {
 *       "author/skill-slug": [
 *         { "slug": "other/skill", "score": 0.87, "name": "...", "category": "..." },
 *         ...
 *       ]
 *     }
 *   }
 */

import { writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords } from './lib/ndjson.js';
import { topKNeighbors, normalizeFloat32, annEngine } from './lib/ann.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VECTORS_PATH = join(ROOT, 'data', 'skill-vectors.ndjson');
const OUTPUT_PATH = join(ROOT, 'data', 'similar-skills.json');
// Phase 3.2.1: runtime is now ~O(N log N) via scripts/lib/ann.js — TOP_K
// affects OUTPUT SIZE only (~40% of similar-skills.json per 2 entries). Safe
// to raise to 5 if the related-skills UI wants more; no runtime cost
// consideration anymore.
const TOP_K = 3;

function log(msg) {
  console.log(`[similar] ${msg}`);
}

/**
 * Pure core: vector records in, { similar, count } out. No I/O.
 *
 * Records without metadata.slug are skipped. Slug collision twins are
 * deduped first-wins (matching historical behavior). Each output entry is
 * { slug, score, name, category, quality_tier } with score rounded to 4
 * decimals and metadata fallbacks '' / '' / 'listed'. Self is excluded;
 * at most topK entries per slug.
 *
 * DESTRUCTIVE on input: surviving records' `values` arrays are nulled after
 * Float32 normalization (Pitfall 7 — at 51k, holding float64 source AND
 * Float32 copies risks heap pressure alongside the Astro build).
 *
 * @param {Array<{id: string, values: number[], metadata?: object}>} records
 * @param {number} topK
 * @returns {{ similar: Record<string, Array<object>>, count: number }}
 */
export function computeSimilar(records, topK = TOP_K) {
  // Build slug → index map
  // Dedupe: some slugs appear twice due to the collision bug. Keep the first (highest quality).
  const slugMap = new Map();
  const deduped = [];
  for (const rec of records) {
    const slug = rec.metadata?.slug;
    if (!slug) continue;
    if (slugMap.has(slug)) continue; // skip collision twin
    slugMap.set(slug, deduped.length);
    deduped.push(rec);
  }

  log(`deduped to ${deduped.length} unique slugs`);

  // ann.js determinism contract: the CALLER sorts items by id (slug) before
  // querying — insertion order feeds HNSW graph construction. Output-object
  // key ORDER therefore becomes slug-sorted (was quality-sorted); consumers
  // look up by slug key, so this is shape-neutral.
  deduped.sort((a, b) => (a.metadata.slug < b.metadata.slug ? -1 : 1));

  const startTime = Date.now();

  // Normalize to Float32 (dot == cosine on unit vectors), then free the
  // float64 source arrays before querying (Pitfall 7 memory release).
  const items = deduped.map((rec) => ({ id: rec.metadata.slug, vec: normalizeFloat32(rec.values) }));
  for (const rec of deduped) rec.values = null; // drop float64 refs before querying

  log(`ann: engine=${annEngine()}`);
  const neighborSets = topKNeighbors(items, topK);

  const similar = {};
  for (let i = 0; i < deduped.length; i++) {
    const slug = deduped[i].metadata.slug;
    similar[slug] = neighborSets[i].map(({ idx, sim }) => ({
      slug: deduped[idx].metadata.slug,
      score: Math.round(sim * 10000) / 10000,
      name: deduped[idx].metadata.name || '',
      category: deduped[idx].metadata.category || '',
      quality_tier: deduped[idx].metadata.quality_tier || 'listed',
    }));

    if ((i + 1) % 5000 === 0) {
      log(`  [${i + 1}/${deduped.length}] computed`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`computed ${Object.keys(similar).length} similar-skill sets in ${elapsed}s`);

  return { similar, count: Object.keys(similar).length };
}

function main() {
  log('=== similar-skills computation start ===');

  if (!existsSync(VECTORS_PATH)) {
    log('no skill-vectors.ndjson found — writing empty similar-skills.json');
    writeFileSync(OUTPUT_PATH, JSON.stringify({
      generated_at: new Date().toISOString(),
      count: 0,
      similar: {},
    }), 'utf-8');
    return;
  }

  // Chunked NDJSON read via scripts/lib/ndjson.js — V8-string-limit safe.
  const recordsMap = readNdjsonRecords(VECTORS_PATH, {
    keyFn: (r) => r.metadata?.slug || r.id,
  });
  const records = [...recordsMap.values()];
  log(`loaded ${records.length} vectors`);

  const { similar, count } = computeSimilar(records, TOP_K);

  const output = {
    generated_at: new Date().toISOString(),
    count,
    similar,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output), 'utf-8');
  log(`wrote ${OUTPUT_PATH}`);
  log('=== similar-skills computation complete ===');
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
