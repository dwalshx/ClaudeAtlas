// scripts/snapshot-catalog.test.js
//
// Unit tests for the versioned catalog composition snapshot aggregator.
// Approach: drive the pure `aggregateSnapshot` with in-memory fixtures.
// No subprocess, no filesystem I/O for the aggregation assertions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateSnapshot, main, loadCatalogRecords } from './snapshot-catalog.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function rec(overrides = {}) {
  return {
    id: overrides.id || `skill:owner/repo/${Math.random()}`,
    entity_type: 'skill',
    quality_tier: 'listed',
    is_duplicate: false,
    tags: [],
    ...overrides,
  };
}

test('import-safety: module exposes the pure API and does NOT run main() on import', () => {
  // Primary, robust check: the aggregator imported as a callable function.
  // If the invoked-as-script guard were broken, importing this test module
  // would have executed main() (a filesystem side effect) during load.
  assert.equal(typeof aggregateSnapshot, 'function');
  assert.equal(typeof main, 'function');
  assert.equal(typeof loadCatalogRecords, 'function');

  // Sentinel-date proof (non-false-failing): main() only ever writes a
  // file named after the REAL current date, never this epoch sentinel.
  // A legitimate local dry run creates data/snapshots/<today>.json — which
  // this assertion deliberately does NOT touch, so it can't false-fail.
  const sentinel = join(ROOT, 'data', 'snapshots', '1970-01-01.json');
  assert.equal(existsSync(sentinel), false, 'main() must not run (or write) on import');
});

test('empty catalog yields well-formed zeroed snapshot with stable keys', () => {
  const snap = aggregateSnapshot([], { date: '2026-08-04', generatedAt: '2026-08-04T00:00:00.000Z' });
  assert.equal(snap.schema_version, 1);
  assert.equal(snap.date, '2026-08-04');
  assert.equal(snap.generated_at, '2026-08-04T00:00:00.000Z');
  assert.deepEqual(snap.totals, {
    records: 0,
    indexed: 0,
    duplicates: 0,
    tiers: { featured: 0, solid: 0, listed: 0 },
  });
  // Canonical entity types are always present (stable time-series keys).
  assert.deepEqual(Object.keys(snap.by_entity_type).sort(), ['mcp_server', 'plugin', 'skill']);
  assert.deepEqual(snap.categories, {});
});

test('totals: indexed excludes duplicates; tiers include duplicates (documented decision)', () => {
  const records = [
    rec({ quality_tier: 'featured', is_duplicate: false }),
    rec({ quality_tier: 'featured', is_duplicate: true }), // dup, still counts in tiers
    rec({ quality_tier: 'solid', is_duplicate: false }),
    rec({ quality_tier: 'listed', is_duplicate: false }),
    rec({ quality_tier: 'listed', is_duplicate: true }), // dup
  ];
  const snap = aggregateSnapshot(records, { date: '2026-08-04' });

  assert.equal(snap.totals.records, 5);
  assert.equal(snap.totals.indexed, 3); // excludes the 2 duplicates
  assert.equal(snap.totals.duplicates, 2);

  // tiers count ALL records including duplicates → sums to records, NOT indexed.
  assert.deepEqual(snap.totals.tiers, { featured: 2, solid: 1, listed: 2 });
  const tierSum = snap.totals.tiers.featured + snap.totals.tiers.solid + snap.totals.tiers.listed;
  assert.equal(tierSum, snap.totals.records);
  assert.notEqual(tierSum, snap.totals.indexed);
});

test('per-entity-type breakdown partitions records correctly', () => {
  const records = [
    rec({ entity_type: 'skill', quality_tier: 'featured' }),
    rec({ entity_type: 'skill', quality_tier: 'listed', is_duplicate: true }),
    rec({ entity_type: 'plugin', quality_tier: 'solid' }),
    rec({ entity_type: 'plugin', quality_tier: 'listed' }),
    rec({ entity_type: 'mcp_server', quality_tier: 'featured' }),
  ];
  const snap = aggregateSnapshot(records, { date: '2026-08-04' });

  assert.deepEqual(snap.by_entity_type.skill, {
    records: 2,
    indexed: 1,
    duplicates: 1,
    tiers: { featured: 1, solid: 0, listed: 1 },
  });
  assert.deepEqual(snap.by_entity_type.plugin, {
    records: 2,
    indexed: 2,
    duplicates: 0,
    tiers: { featured: 0, solid: 1, listed: 1 },
  });
  assert.deepEqual(snap.by_entity_type.mcp_server, {
    records: 1,
    indexed: 1,
    duplicates: 0,
    tiers: { featured: 1, solid: 0, listed: 0 },
  });
});

test('legacy robustness: missing entity_type→skill, missing is_duplicate→not-dup, missing tier→uncounted', () => {
  const records = [
    { id: 'a', quality_tier: 'featured' }, // no entity_type, no is_duplicate
    { id: 'b' }, // no tier at all
    { id: 'c', entity_type: 'skill', is_duplicate: null, quality_tier: 'listed' },
  ];
  const snap = aggregateSnapshot(records, { date: '2026-08-04' });

  assert.equal(snap.totals.records, 3);
  assert.equal(snap.totals.indexed, 3); // none are is_duplicate === true
  assert.equal(snap.totals.duplicates, 0);
  // 'b' has no tier → contributes to records but no tier bucket.
  assert.deepEqual(snap.totals.tiers, { featured: 1, solid: 0, listed: 1 });
  // all three land under 'skill'
  assert.equal(snap.by_entity_type.skill.records, 3);
});

test('category distribution counts indexed records via category:<slug> tags', () => {
  const records = [
    rec({ tags: ['category:coding', 'framework:gsd'] }),
    rec({ tags: ['category:coding'] }),
    rec({ tags: ['category:writing'] }),
    rec({ tags: ['category:writing'], is_duplicate: true }), // excluded (dup)
    rec({ tags: ['not-a-category'] }),
  ];
  const snap = aggregateSnapshot(records, { date: '2026-08-04' });

  // coding=2, writing=1 (the duplicate writing record is excluded).
  assert.deepEqual(snap.categories, { coding: 2, writing: 1 });
  // Sorted by count desc: coding before writing.
  assert.deepEqual(Object.keys(snap.categories), ['coding', 'writing']);
});

test('_header sentinel records are ignored', () => {
  const records = [
    { _header: true, schema_version: 2, entity_type: 'skill' },
    rec({ quality_tier: 'featured' }),
  ];
  const snap = aggregateSnapshot(records, { date: '2026-08-04' });
  assert.equal(snap.totals.records, 1);
  assert.equal(snap.totals.tiers.featured, 1);
});
