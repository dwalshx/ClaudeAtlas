/**
 * scripts/__tests__/compute-similar.test.js
 *
 * Phase 3.2.1 Plan 04 Task 1: output-shape regression lock for
 * scripts/compute-similar.js — written and GREEN against the ORIGINAL naive
 * O(n²) implementation BEFORE the ann.js engine swap (the Wave-0 baseline
 * gap from VALIDATION.md). The exact same suite must stay green after the
 * swap; that sequencing is the whole point.
 *
 * Deliberately engine-agnostic:
 *   - no assertions on output-object KEY ORDER (the ann.js rewrite sorts
 *     deduped records by slug; consumers look up by key)
 *   - exact score assertions only on geometrically unambiguous values
 *     (0, 0.5, 1/√2, 1) that survive the float64-cosine → Float32-dot move
 *     after 4-decimal rounding
 *   - fixture slug order == array order so deterministic tie-breaking
 *     (stable sort vs idx-ascending) picks identical neighbors
 *   - a FRESH fixture per computeSimilar() call: the ANN implementation may
 *     consume rec.values destructively (Pitfall 7 memory release)
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSimilar } from '../compute-similar.js';

/**
 * 8 records, 8-dim vectors. Geometry (after unit-normalization):
 *   sa=[1,0,...]        sb=[1,1,0,...]      sc=[0,1,0,...]
 *   sd=[0,0,1,0,...]    se=[0,0,1,1,0,...]  sf=[0,0,0,0,1,0,...]
 *   sg=[0,0,0,0,1,1,0,0] sh=[1,0,0,0,0,0,0,1]
 * Notable sims: sb·sa = sb·sc = 1/√2 ≈ 0.7071; sb·sh = 0.5; sa·sh = 1/√2;
 * disjoint-support pairs are exactly 0.
 */
function makeRecords() {
  const mk = (slug, name, values) => ({
    id: `skill:${slug}`,
    values,
    metadata: { slug, name, category: 'productivity', quality_tier: 'featured' },
  });
  return [
    mk('a/sa', 'Skill A', [1, 0, 0, 0, 0, 0, 0, 0]),
    mk('a/sb', 'Skill B', [1, 1, 0, 0, 0, 0, 0, 0]),
    mk('a/sc', 'Skill C', [0, 1, 0, 0, 0, 0, 0, 0]),
    mk('a/sd', 'Skill D', [0, 0, 1, 0, 0, 0, 0, 0]),
    mk('a/se', 'Skill E', [0, 0, 1, 1, 0, 0, 0, 0]),
    mk('a/sf', 'Skill F', [0, 0, 0, 0, 1, 0, 0, 0]),
    mk('a/sg', 'Skill G', [0, 0, 0, 0, 1, 1, 0, 0]),
    mk('a/sh', 'Skill H', [1, 0, 0, 0, 0, 0, 0, 1]),
  ];
}

const FIXTURE_SLUGS = makeRecords().map((r) => r.metadata.slug);

test('shape: slug keys, ≤K entries, exact entry keys, no self, 4-decimal scores, desc order', () => {
  const { similar, count } = computeSimilar(makeRecords(), 3);

  assert.equal(count, 8);
  assert.deepEqual(Object.keys(similar).sort(), [...FIXTURE_SLUGS].sort());

  for (const [key, entries] of Object.entries(similar)) {
    assert.ok(Array.isArray(entries), `entries for ${key} is an array`);
    assert.ok(entries.length <= 3, `≤ TOP_K entries for ${key}`);
    assert.ok(entries.length >= 1, `n=8 with k=3 → at least one neighbor for ${key}`);
    let prev = Infinity;
    for (const e of entries) {
      assert.deepEqual(
        Object.keys(e).sort(),
        ['category', 'name', 'quality_tier', 'score', 'slug'],
        `entry has exactly the contract keys for ${key}`,
      );
      assert.notEqual(e.slug, key, `self excluded for ${key}`);
      assert.ok(FIXTURE_SLUGS.includes(e.slug), `neighbor slug is a real record for ${key}`);
      assert.equal(typeof e.score, 'number');
      assert.equal(e.score, Math.round(e.score * 10000) / 10000, '4-decimal rounding applied');
      assert.ok(e.score <= prev, `scores descend within ${key}`);
      prev = e.score;
      assert.equal(typeof e.name, 'string');
      assert.equal(typeof e.category, 'string');
      assert.equal(typeof e.quality_tier, 'string');
    }
  }
});

test('known geometry: a/sb top-3 is sa & sc at 0.7071 then sh at 0.5', () => {
  const { similar } = computeSimilar(makeRecords(), 3);
  const entries = similar['a/sb'];
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => e.slug), ['a/sa', 'a/sc', 'a/sh']);
  assert.deepEqual(entries.map((e) => e.score), [0.7071, 0.7071, 0.5]);
  assert.deepEqual(entries.map((e) => e.name), ['Skill A', 'Skill C', 'Skill H']);
});

test('collision twins: same slug appears once in output, first record wins', () => {
  const records = [
    { id: 'skill:x/a', values: [1, 0, 0, 0], metadata: { slug: 'x/a', name: 'Anchor', category: 'dev', quality_tier: 'solid' } },
    { id: 'skill:x/dup-1', values: [1, 0, 0, 0], metadata: { slug: 'x/dup', name: 'First Twin', category: 'c1', quality_tier: 'featured' } },
    { id: 'skill:x/dup-2', values: [0, 1, 0, 0], metadata: { slug: 'x/dup', name: 'Second Twin', category: 'c2', quality_tier: 'listed' } },
  ];
  const { similar, count } = computeSimilar(records, 3);

  assert.equal(count, 2);
  assert.deepEqual(Object.keys(similar).sort(), ['x/a', 'x/dup']);

  // x/a's sole neighbor is the FIRST twin: identical vector → score exactly 1,
  // and the entry metadata comes from the first record, not the second.
  assert.equal(similar['x/a'].length, 1);
  const [nb] = similar['x/a'];
  assert.equal(nb.slug, 'x/dup');
  assert.equal(nb.score, 1);
  assert.equal(nb.name, 'First Twin');
  assert.equal(nb.category, 'c1');
  assert.equal(nb.quality_tier, 'featured');
});

test('records without metadata.slug are skipped entirely (not keys, not neighbors)', () => {
  const records = [
    { id: 'skill:y/one', values: [1, 0, 0, 0], metadata: { slug: 'y/one', name: 'One', category: 'dev', quality_tier: 'solid' } },
    { id: 'skill:y/two', values: [1, 1, 0, 0], metadata: { slug: 'y/two', name: 'Two', category: 'dev', quality_tier: 'solid' } },
    // Near-identical to y/one — would dominate as a neighbor if not skipped.
    { id: 'skill:noslug', values: [1, 0, 0, 0], metadata: { name: 'No Slug' } },
    // No metadata at all.
    { id: 'skill:nometa', values: [1, 1, 0, 0] },
  ];
  const { similar, count } = computeSimilar(records, 3);

  assert.equal(count, 2);
  assert.deepEqual(Object.keys(similar).sort(), ['y/one', 'y/two']);
  for (const entries of Object.values(similar)) {
    for (const e of entries) {
      assert.ok(['y/one', 'y/two'].includes(e.slug), 'slugless records never appear as neighbors');
    }
  }
});

test('metadata fallbacks: missing name/category/quality_tier → "" / "" / "listed"', () => {
  const records = [
    { id: 'skill:z/full', values: [1, 0], metadata: { slug: 'z/full', name: 'Full', category: 'dev', quality_tier: 'featured' } },
    { id: 'skill:z/bare', values: [1, 1], metadata: { slug: 'z/bare' } },
  ];
  const { similar } = computeSimilar(records, 3);

  const [nb] = similar['z/full'];
  assert.equal(nb.slug, 'z/bare');
  assert.equal(nb.name, '');
  assert.equal(nb.category, '');
  assert.equal(nb.quality_tier, 'listed');
});

test('determinism: identical input produces JSON-identical output', () => {
  const a = computeSimilar(makeRecords(), 3);
  const b = computeSimilar(makeRecords(), 3);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('topK bounds the per-slug entry count', () => {
  const { similar } = computeSimilar(makeRecords(), 2);
  for (const entries of Object.values(similar)) {
    assert.equal(entries.length, 2);
  }
});
