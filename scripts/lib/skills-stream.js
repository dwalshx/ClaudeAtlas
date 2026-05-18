/**
 * Streaming skills loader for the F1 streaming foundation.
 *
 * Reads `data/skills.ndjson` (or an override path) via the chunked
 * NDJSON helper, returns the full array. Caches per-path via a module-
 * level memo so Astro's many getStaticPaths() calls during build don't
 * re-parse the same file 1000x.
 *
 * Synchronous on purpose — Astro's data-loading callsites are sync.
 * The chunked readSync in scripts/lib/ndjson.js avoids the V8 ~536 MB
 * string limit, so this stays safe up to ~200k records.
 *
 * Used behind the F1_STREAMING_LOADER env flag during T2 → T5 transition.
 * T5 makes this the default in src/lib/skills.js.
 */

import { readNdjsonRecords } from './ndjson.js';

const memo = new Map();

/**
 * @param {string} path Absolute path to skills.ndjson (or override).
 * @returns {object[]} All skill records, in file order. _header lines filtered.
 */
export function loadAllSkillsSync(path) {
  const map = readNdjsonRecords(path, { keyFn: (r) => r.id || r.slug });
  return [...map.values()];
}

/**
 * Memoized variant — Astro getStaticPaths() can call repeatedly.
 * @param {string} path
 * @returns {object[]}
 */
export function loadAllSkillsMemo(path) {
  if (!memo.has(path)) {
    memo.set(path, loadAllSkillsSync(path));
  }
  return memo.get(path);
}

// Test-only: clears the memo so test runs don't pollute each other.
export function _resetMemo() {
  memo.clear();
}
