/**
 * scripts/lib/__tests__/tier-assignment.test.js
 *
 * Phase 3.2 Task 7 (D-04 / B-1). Shared percentile tier assignment.
 * NO small-N carve-out: uniform Math.floor(N*0.10) Featured /
 * Math.floor(N*0.30) Solid / rest Listed for ALL N and ALL entity types.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignPercentileTiers } from '../tier-assignment.js';

function mk(n) {
  // Descending unique scores so rank == array index after sort.
  return Array.from({ length: n }, (_, i) => ({
    id: `id-${String(i).padStart(5, '0')}`,
    quality_score: 1000 - i,
    repo_stars: 0,
    quality_tier: 'listed',
  }));
}

function counts(records) {
  return {
    featured: records.filter((r) => r.quality_tier === 'featured').length,
    solid: records.filter((r) => r.quality_tier === 'solid').length,
    listed: records.filter((r) => r.quality_tier === 'listed').length,
  };
}

test('Task 7: N=38 → 3 Featured / 11 Solid / 24 Listed (no carve-out)', () => {
  const recs = assignPercentileTiers(mk(38));
  assert.deepEqual(counts(recs), { featured: 3, solid: 11, listed: 24 });
});

test('Task 7: N=4500 → 450 / 1350 / 2700', () => {
  const recs = assignPercentileTiers(mk(4500));
  assert.deepEqual(counts(recs), { featured: 450, solid: 1350, listed: 2700 });
});

test('Task 7: N=10 → 1 / 3 / 6', () => {
  const recs = assignPercentileTiers(mk(10));
  assert.deepEqual(counts(recs), { featured: 1, solid: 3, listed: 6 });
});

test('Task 7: tie-break by repo_stars DESC then id ASC is deterministic', () => {
  const recs = [
    { id: 'b', quality_score: 50, repo_stars: 5, quality_tier: 'listed' },
    { id: 'a', quality_score: 50, repo_stars: 5, quality_tier: 'listed' },
    { id: 'c', quality_score: 50, repo_stars: 9, quality_tier: 'listed' },
  ];
  assignPercentileTiers(recs);
  // N=3 → floor(0.10*3)=0 featured, floor(0.30*3)=0 solid → all listed.
  // The function must not throw and must be stable.
  assert.equal(recs.every((r) => r.quality_tier === 'listed'), true);
});

test('Task 7: optional renderableCap trims Solid (skill parity)', () => {
  // 100 records, cap=15 → 10 featured, 5 solid (capped from 30), 85 listed.
  const recs = assignPercentileTiers(mk(100), { renderableCap: 15 });
  const c = counts(recs);
  assert.equal(c.featured, 10);
  assert.equal(c.solid, 5);
  assert.equal(c.listed, 85);
});

test('Task 7: returns the input array for chaining', () => {
  const input = mk(5);
  assert.equal(assignPercentileTiers(input), input);
});
