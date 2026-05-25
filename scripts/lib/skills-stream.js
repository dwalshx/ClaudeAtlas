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

import { readFileSync, existsSync } from 'node:fs';
import { readNdjsonRecords } from './ndjson.js';
import { resolveSkillsNdjsonPath } from './build-input.js';

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

/**
 * Helper for pipeline scripts during the T5 transition window: resolves the
 * skills path via resolveSkillsNdjsonPath() and loads the array. If the
 * resolved path is the legacy JSON-array file (skills.json), falls back to
 * JSON.parse — that branch logs a loud warning and will be dropped in a
 * post-T5 cleanup commit (one week after main stabilizes on NDJSON).
 *
 * Use this in any pipeline script that reads `data/skills.json` today and
 * will read `data/skills.ndjson` post-T5. Replaces the
 * `JSON.parse(readFileSync(SKILLS_PATH, 'utf-8'))` pattern.
 *
 * @returns {object[]}
 */
export function loadSkillsArray() {
  const path = resolveSkillsNdjsonPath();
  if (path.endsWith('.ndjson')) {
    return loadAllSkillsSync(path);
  }
  // Legacy JSON-array path — bounded by the V8 string limit (~536 MB).
  // Logged by build-input.js with a loud warning when this branch fires.
  if (!existsSync(path)) {
    throw new Error(`[skills-stream] resolved path missing: ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8'));
}
