#!/usr/bin/env node

/**
 * ClaudeAtlas Similar-Skills Pre-Computation
 *
 * Reads data/skill-vectors.ndjson (the embedding cache) and computes the top-5
 * most similar skills for each skill using cosine similarity. Writes the
 * results to data/similar-skills.json.
 *
 * This runs at build time (before Astro) so detail pages can render a
 * "Similar Skills" section without any client-side vector math or API calls.
 *
 * Algorithm:
 *   For each skill vector, compute cosine similarity against every other skill
 *   vector. Keep the top 5 (excluding self). O(n²) but n=1078 so it runs in
 *   ~2 seconds.
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

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readNdjsonRecords } from './lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const VECTORS_PATH = join(ROOT, 'data', 'skill-vectors.ndjson');
const OUTPUT_PATH = join(ROOT, 'data', 'similar-skills.json');
// Phase 3.2 Task 13 (3.2-DOD-12): reduced 5 → 3. NOTE: this is an OUTPUT-SIZE
// trim only (shrinks similar-skills.json ~40%), NOT a compute mitigation. The
// dominant cost here is the O(n²) cosine scan + per-row full sort below; TOP_K
// only bounds the retained slice. See 3.2-CRON-AUDIT.md. If the "related skills"
// UI feels too sparse, bump back toward 5 — the runtime cost is unchanged.
const TOP_K = 3;

function log(msg) {
  console.log(`[similar] ${msg}`);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
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

  const startTime = Date.now();
  const similar = {};

  for (let i = 0; i < deduped.length; i++) {
    const rec = deduped[i];
    const slug = rec.metadata.slug;
    const vec = rec.values;

    // Compute similarity against every other skill
    const scores = [];
    for (let j = 0; j < deduped.length; j++) {
      if (i === j) continue;
      const score = cosineSimilarity(vec, deduped[j].values);
      scores.push({ j, score });
    }

    // Keep top K
    scores.sort((a, b) => b.score - a.score);
    similar[slug] = scores.slice(0, TOP_K).map(({ j, score }) => ({
      slug: deduped[j].metadata.slug,
      score: Math.round(score * 10000) / 10000,
      name: deduped[j].metadata.name || '',
      category: deduped[j].metadata.category || '',
      quality_tier: deduped[j].metadata.quality_tier || 'listed',
    }));

    if ((i + 1) % 200 === 0) {
      log(`  [${i + 1}/${deduped.length}] computed`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  log(`computed ${Object.keys(similar).length} similar-skill sets in ${elapsed}s`);

  const output = {
    generated_at: new Date().toISOString(),
    count: Object.keys(similar).length,
    similar,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output), 'utf-8');
  log(`wrote ${OUTPUT_PATH}`);
  log('=== similar-skills computation complete ===');
}

main();
