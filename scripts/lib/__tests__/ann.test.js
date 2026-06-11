/**
 * scripts/lib/__tests__/ann.test.js
 *
 * Contract tests for scripts/lib/ann.js (Phase 3.2.1 Plan 01).
 * `node --test` only — no external test framework.
 *
 * Coverage:
 *   Test 1 — exactTopK correctness on hand-computable 4-dim unit vectors
 *   Test 2 — topKNeighbors contract: self exclusion, sort order, k clamp
 *   Test 3 — determinism: identical input → byte-identical output
 *   Test 4 — hnsw vs exact parity (neighbor SETS identical, sims EXACTLY
 *            equal — both paths recompute sims via dot). Skips on the
 *            exact-fallback engine UNLESS ANN_REQUIRE_HNSW=1, in which
 *            case it hard-fails (anti-silent-fallback defense for CI).
 *   Test 5 — ip-sign sanity: planted near-duplicate is the #1 neighbor
 *            with sim > 0.98 (catches the hnswlib 'ip' 1-distance
 *            inversion) — runs on whichever engine is active
 *   Test 6 — annEngine() reports 'hnsw' or 'exact'
 *   Test 7 — engine override 'hnsw' throws when the native module is
 *            unavailable (fallback contract)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  annEngine,
  normalizeFloat32,
  dot,
  exactTopK,
  topKNeighbors,
} from '../ann.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/**
 * EMBED_DRY_RUN fake-vector recipe (mirrors scripts/embed-skills.js):
 * SHA-256 of the id, bytes tiled to `dims`, each byte b → (b / 127.5) - 1,
 * then unit-normalized.
 */
function dryRunVec(id, dims = 1536) {
  const hash = createHash('sha256').update(id).digest();
  const v = new Array(dims);
  for (let i = 0; i < dims; i++) v[i] = hash[i % hash.length] / 127.5 - 1;
  return normalizeFloat32(v);
}

/** Deterministic seeded PRNG (mulberry32) for reproducible fixtures. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 200 vectors × 64 dims, seeded, sorted by id (caller contract), with 3
 * planted near-duplicate pairs at sim ≈ 0.99: (10,11), (50,51), (120,121).
 */
function parityFixture() {
  const rand = mulberry32(42);
  const N = 200;
  const D = 64;
  const items = [];
  for (let i = 0; i < N; i++) {
    const v = new Array(D);
    for (let d = 0; d < D; d++) v[d] = rand() * 2 - 1;
    items.push({ id: `vec-${String(i).padStart(3, '0')}`, vec: normalizeFloat32(v) });
  }
  // Plant near-duplicates: small perturbation of the base keeps cosine ≈ 0.99.
  for (const [a, b] of [[10, 11], [50, 51], [120, 121]]) {
    const base = items[a].vec;
    const v = new Array(D);
    for (let d = 0; d < D; d++) v[d] = base[d] + (rand() * 2 - 1) * 0.02;
    items[b] = { id: items[b].id, vec: normalizeFloat32(v) };
  }
  return items;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('Test 1: exactTopK correctness on hand-computable 4-dim unit vectors', () => {
  const items = [
    { id: 'a', vec: normalizeFloat32([1, 0, 0, 0]) },
    { id: 'b', vec: normalizeFloat32([0, 1, 0, 0]) },
    { id: 'c', vec: normalizeFloat32([1, 1, 0, 0]) }, // 1/√2 on dims 0+1
    { id: 'd', vec: normalizeFloat32([0, 0, 1, 0]) },
  ];
  const res = exactTopK(items, 2);
  const R = Math.SQRT1_2; // ≈ 0.7071067811865476

  // item 0 (a): top = c at ~0.7071; then tie (b=0, d=0) broken idx ASC → b
  assert.equal(res[0][0].idx, 2);
  assert.ok(Math.abs(res[0][0].sim - R) < 1e-6, `got ${res[0][0].sim}`);
  assert.equal(res[0][1].idx, 1);
  assert.ok(Math.abs(res[0][1].sim) < 1e-6);

  // item 1 (b): top = c at ~0.7071; then tie (a=0, d=0) → a
  assert.equal(res[1][0].idx, 2);
  assert.ok(Math.abs(res[1][0].sim - R) < 1e-6);
  assert.equal(res[1][1].idx, 0);
  assert.ok(Math.abs(res[1][1].sim) < 1e-6);

  // item 2 (c): exact tie between a and b at ~0.7071 → idx ASC: a then b
  assert.equal(res[2][0].idx, 0);
  assert.equal(res[2][1].idx, 1);
  assert.ok(Math.abs(res[2][0].sim - R) < 1e-6);
  assert.ok(Math.abs(res[2][1].sim - R) < 1e-6);

  // item 3 (d): all sims 0 → idx ASC: a, b
  assert.equal(res[3][0].idx, 0);
  assert.equal(res[3][1].idx, 1);
  assert.ok(Math.abs(res[3][0].sim) < 1e-6);
});

test('Test 2: topKNeighbors exact-engine contract — self exclusion, sort, clamp', () => {
  // Clamp: n=2, k=64 → exactly n-1 = 1 neighbor each (enrich.test.js
  // fixtures depend on K_DUP=64 working at tiny n).
  const two = [
    { id: 'x', vec: normalizeFloat32([1, 0, 0, 0]) },
    { id: 'y', vec: normalizeFloat32([1, 1, 0, 0]) },
  ];
  const clamped = topKNeighbors(two, 64, { engine: 'exact' });
  assert.equal(clamped.length, 2);
  assert.equal(clamped[0].length, 1, 'k > n-1 must clamp to n-1 results');
  assert.equal(clamped[1].length, 1);
  assert.equal(clamped[0][0].idx, 1);
  assert.equal(clamped[1][0].idx, 0);
  assert.ok(Math.abs(clamped[0][0].sim - Math.SQRT1_2) < 1e-6);

  // Self exclusion + sort order on a slightly larger seeded set.
  const rand = mulberry32(7);
  const items = [];
  for (let i = 0; i < 12; i++) {
    const v = Array.from({ length: 8 }, () => rand() * 2 - 1);
    items.push({ id: `id-${String(i).padStart(2, '0')}`, vec: normalizeFloat32(v) });
  }
  const res = topKNeighbors(items, 5, { engine: 'exact' });
  assert.equal(res.length, 12);
  for (let i = 0; i < items.length; i++) {
    assert.equal(res[i].length, 5);
    for (const n of res[i]) assert.notEqual(n.idx, i, 'self must be excluded');
    for (let j = 1; j < res[i].length; j++) {
      const prev = res[i][j - 1];
      const cur = res[i][j];
      assert.ok(
        prev.sim > cur.sim || (prev.sim === cur.sim && prev.idx < cur.idx),
        `item ${i}: results must be sorted sim DESC, ties idx ASC`
      );
    }
  }
});

test('Test 3: determinism — identical input twice → byte-identical output', () => {
  // EMBED_DRY_RUN-shaped fixture: 64 fake vectors at full 1536 dims.
  const items = Array.from({ length: 64 }, (_, i) => ({
    id: `id-${i}`,
    vec: dryRunVec(`id-${i}`),
  }));
  // Caller contract: array sorted by id before calling.
  items.sort((a, b) => (a.id < b.id ? -1 : 1));

  const first = topKNeighbors(items, 8);
  const second = topKNeighbors(items, 8);
  assert.equal(
    JSON.stringify(first),
    JSON.stringify(second),
    'same input must produce byte-identical output (sorted insertion + randomSeed=100)'
  );
});

test('Test 4: parity — hnsw and exact return identical neighbor sets + exactly equal sims', (t) => {
  if (annEngine() !== 'hnsw') {
    if (process.env.ANN_REQUIRE_HNSW === '1') {
      assert.fail('hnsw engine required but unavailable (ANN_REQUIRE_HNSW=1) — native build broke?');
    }
    t.skip('hnswlib-node unavailable on this box — exact fallback active; parity runs in CI');
    return;
  }

  const items = parityFixture();
  const hnsw = topKNeighbors(items, 10, { engine: 'hnsw' });
  const exact = topKNeighbors(items, 10, { engine: 'exact' });
  assert.equal(hnsw.length, exact.length);

  for (let i = 0; i < items.length; i++) {
    const hSet = hnsw[i].map((n) => n.idx).sort((a, b) => a - b);
    const eSet = exact[i].map((n) => n.idx).sort((a, b) => a - b);
    assert.deepEqual(hSet, eSet, `neighbor SET mismatch at item ${i}`);

    // Sims must be EXACTLY equal (not 1e-5 tolerance): both paths recompute
    // sims via dot() over the same Float32Arrays, discarding the index's
    // 1-distance values.
    const hSims = new Map(hnsw[i].map((n) => [n.idx, n.sim]));
    for (const { idx, sim } of exact[i]) {
      assert.equal(hSims.get(idx), sim, `sim mismatch at item ${i}, neighbor ${idx}`);
    }
  }
});

test('Test 5: ip-sign sanity — planted near-duplicate is #1 neighbor, sim > 0.98', () => {
  // Runs on whichever engine is active. If the hnsw path treated the 'ip'
  // distance (1 - dot) as a similarity, rankings would invert and the
  // near-duplicate would land LAST, failing this test.
  const items = parityFixture();
  const res = topKNeighbors(items, 10);

  assert.equal(res[10][0].idx, 11, 'vec-011 must be vec-010\'s top neighbor');
  assert.ok(res[10][0].sim > 0.98, `expected sim > 0.98, got ${res[10][0].sim}`);
  assert.equal(res[11][0].idx, 10);
  assert.ok(res[11][0].sim > 0.98);
  assert.equal(res[50][0].idx, 51);
  assert.ok(res[50][0].sim > 0.98);
  assert.equal(res[120][0].idx, 121);
  assert.ok(res[120][0].sim > 0.98);

  // Cross-check the planted sim against a direct dot (ground truth).
  assert.equal(res[10][0].sim, dot(items[10].vec, items[11].vec));
});

test('Test 6: annEngine() reports hnsw or exact', () => {
  assert.ok(['hnsw', 'exact'].includes(annEngine()), `got ${annEngine()}`);
});

test('Test 7: engine override "hnsw" throws when native module unavailable', (t) => {
  if (annEngine() === 'hnsw') {
    t.skip('native module loaded — the unavailable-override branch cannot be exercised here');
    return;
  }
  assert.throws(
    () =>
      topKNeighbors(
        [
          { id: 'a', vec: normalizeFloat32([1, 0]) },
          { id: 'b', vec: normalizeFloat32([0, 1]) },
        ],
        1,
        { engine: 'hnsw' }
      ),
    /hnsw/i,
    'forcing engine:"hnsw" without the native module must throw, never silently fall back'
  );
});
