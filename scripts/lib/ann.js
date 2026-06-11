/**
 * scripts/lib/ann.js — shared approximate-nearest-neighbor helper
 * (Phase 3.2.1 Plan 01).
 *
 * Single owner of vector prep + neighbor search for both O(N²) consumers
 * (scripts/enrich.js dedup/novelty and scripts/compute-similar.js top-K).
 * Consumers import from here and NEVER import hnswlib-node directly.
 *
 * Engine detection: tries the native hnswlib-node addon (optionalDependency
 * — node-gyp compile succeeds on ubuntu CI, fails on the win32-arm64 dev
 * box, which is expected and fine). Falls back LOUDLY to the exact Float32
 * brute-force engine (factored verbatim from scripts/enrich.js).
 *
 * Determinism contract (Pitfall 3, RESEARCH.md):
 *   - The CALLER must sort `items` by id before calling — insertion order
 *     feeds HNSW graph construction.
 *   - randomSeed is FIXED at 100 (passed explicitly), M=16,
 *     efConstruction=200 (locked decision).
 *   - Given identical input, both engines produce byte-identical output.
 *
 * Exact-verification contract (locked decision): the hnsw path recomputes
 * every candidate's similarity via dot() and DISCARDS the index's
 * `1 - distance` value, so hnsw and exact paths are numerically IDENTICAL
 * on overlapping candidates. The approximation can only MISS neighbors,
 * never invent or misrank them — no false dedup merges from float drift.
 *
 * No file I/O in this module — pure in-memory math.
 */

import { createRequire } from 'node:module';

let HierarchicalNSW = null;
let engine = 'exact';
try {
  const require = createRequire(import.meta.url);
  ({ HierarchicalNSW } = require('hnswlib-node'));
  engine = 'hnsw';
} catch (err) {
  console.warn(`[ann] hnswlib-node unavailable (${err.message}) — falling back to exact brute-force`);
}
// LOAD-BEARING log line: daily-scrape.yml gates grep for `[ann] engine=hnsw`
// on scheduled runs (Plan 05) so the exact fallback can never silently
// regress production to O(N²).
console.log(`[ann] engine=${engine}`);

/**
 * @returns {'hnsw'|'exact'} which engine loaded at import time.
 */
export function annEngine() {
  return engine;
}

/**
 * Pre-normalize a vector to unit length. After normalization, plain dot
 * product = cosine similarity. Stored as Float32 for ~2× speed.
 * (Verbatim from scripts/enrich.js.)
 *
 * @param {ArrayLike<number>} values
 * @returns {Float32Array}
 */
export function normalizeFloat32(values) {
  const nv = new Float32Array(values.length);
  let n = 0;
  for (let i = 0; i < values.length; i++) n += values[i] * values[i];
  n = Math.sqrt(n);
  if (n === 0) return nv;
  for (let i = 0; i < values.length; i++) nv[i] = values[i] / n;
  return nv;
}

/**
 * Dot product. On pre-normalized vectors this IS the cosine similarity.
 * (Verbatim from scripts/enrich.js.)
 *
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 * @returns {number}
 */
export function dot(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

/** Sort comparator: sim DESC, ties broken idx ASC. */
function compareNeighbors(a, b) {
  if (b.sim !== a.sim) return b.sim - a.sim;
  return a.idx - b.idx;
}

/**
 * Insert a candidate into a bounded, sorted (sim DESC, idx ASC) neighbor
 * list of max length `kk`. O(1) reject for the common worse-than-worst case;
 * binary-search splice otherwise.
 */
function insertNeighbor(list, kk, cand) {
  if (list.length >= kk && compareNeighbors(cand, list[list.length - 1]) >= 0) return;
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (compareNeighbors(cand, list[mid]) < 0) hi = mid;
    else lo = mid + 1;
  }
  list.splice(lo, 0, cand);
  if (list.length > kk) list.pop();
}

/**
 * Exact O(n²) top-K via symmetric i<j dot loop with per-item bounded top-k.
 * Same return contract as topKNeighbors. This is the dev-box engine, the
 * small-fixture test engine, and the Plan 05 validation baseline — clarity
 * over micro-optimization, but Float32 + dot only (no per-pair norm
 * recompute).
 *
 * @param {Array<{id: string, vec: Float32Array}>} items pre-normalized,
 *   caller-sorted by id
 * @param {number} k
 * @returns {Array<Array<{idx: number, sim: number}>>}
 */
export function exactTopK(items, k) {
  const n = items.length;
  const kk = Math.max(0, Math.min(k, n - 1));
  const results = Array.from({ length: n }, () => []);
  if (kk === 0) return results;
  for (let i = 0; i < n; i++) {
    const vi = items[i].vec;
    const ri = results[i];
    for (let j = i + 1; j < n; j++) {
      const sim = dot(vi, items[j].vec);
      insertNeighbor(ri, kk, { idx: j, sim });
      insertNeighbor(results[j], kk, { idx: i, sim });
    }
  }
  return results;
}

/**
 * Per-item top-K nearest neighbors.
 *
 * Contracts:
 *   - `items`: Array<{ id: string, vec: Float32Array }> — vecs MUST be
 *     pre-normalized (dot == cosine) and the array MUST be sorted by id by
 *     the CALLER (determinism contract).
 *   - Returns Array<Array<{ idx: number, sim: number }>> — per-item
 *     neighbors, self excluded, length ≤ min(k, n-1), sorted sim DESC,
 *     ties idx ASC.
 *   - `engineOverride`: 'exact' forces the fallback path even when hnsw is
 *     loaded; 'hnsw' THROWS if the native module is unavailable (never
 *     silently falls back). Used by tests and the Plan 05 validation
 *     harness.
 *
 * @param {Array<{id: string, vec: Float32Array}>} items
 * @param {number} k
 * @param {{efSearch?: number, engine?: 'hnsw'|'exact'|null}} [opts]
 * @returns {Array<Array<{idx: number, sim: number}>>}
 */
export function topKNeighbors(items, k, { efSearch = Math.max(2 * k, 100), engine: engineOverride = null } = {}) {
  if (engineOverride === 'hnsw' && engine !== 'hnsw') {
    throw new Error('[ann] engine "hnsw" requested but hnswlib-node is unavailable on this platform');
  }
  const effective = engineOverride || engine;
  if (effective !== 'hnsw') return exactTopK(items, k);

  const n = items.length;
  if (n === 0) return [];
  const kk = Math.max(0, Math.min(k, n - 1));
  if (kk === 0) return items.map(() => []);

  const dim = items[0].vec.length;
  // 'ip' space on pre-normalized vectors: inner product == cosine. hnswlib
  // reports distance = 1 - dot (Pitfall 5) — we discard it entirely below.
  const index = new HierarchicalNSW('ip', dim);
  index.initIndex(items.length, 16, 200, 100); // M=16, efConstruction=200, randomSeed=100 — FIXED (locked decision)
  for (let i = 0; i < n; i++) index.addPoint(Array.from(items[i].vec), i); // insertion order = caller's id sort
  index.setEf(Math.max(efSearch, kk + 1));

  return items.map((it, i) => {
    const query = Array.from(it.vec);
    const { neighbors } = index.searchKnn(query, Math.min(kk + 1, n));
    const out = [];
    for (let j = 0; j < neighbors.length; j++) {
      const nb = neighbors[j];
      if (nb === i) continue; // drop self
      // EXACT VERIFICATION: recompute sim via dot, discard 1-distance.
      out.push({ idx: nb, sim: dot(it.vec, items[nb].vec) });
    }
    out.sort(compareNeighbors);
    return out.slice(0, kk);
  });
}
