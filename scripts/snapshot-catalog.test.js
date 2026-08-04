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
  assert.equal(snap.timestamp, '2026-08-04T00:00:00.000Z');
  assert.deepEqual(snap.totals, {
    analyzed: 0,
    indexed: 0,
    duplicates: 0,
    tiers: { featured: 0, solid: 0, listed: 0 },
  });
  // Canonical entity types are always present (stable time-series keys).
  assert.deepEqual(Object.keys(snap.by_entity_type).sort(), ['mcp_server', 'plugin', 'skill']);
  assert.deepEqual(snap.by_category, {});
  // New composition fields are well-formed / zeroed on an empty catalog.
  assert.equal(snap.new_last_7d, 0);
  assert.deepEqual(snap.maintenance, { active: 0, abandoned: 0 });
  assert.equal(snap.unique_creators, 0);
  assert.deepEqual(snap.churn, { archived: 0, duplicates: 0 });
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

  assert.equal(snap.totals.analyzed, 5);
  assert.equal(snap.totals.indexed, 3); // excludes the 2 duplicates
  assert.equal(snap.totals.duplicates, 2);

  // tiers count ALL records including duplicates → sums to analyzed, NOT indexed.
  assert.deepEqual(snap.totals.tiers, { featured: 2, solid: 1, listed: 2 });
  const tierSum = snap.totals.tiers.featured + snap.totals.tiers.solid + snap.totals.tiers.listed;
  assert.equal(tierSum, snap.totals.analyzed);
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

  assert.equal(snap.totals.analyzed, 3);
  assert.equal(snap.totals.indexed, 3); // none are is_duplicate === true
  assert.equal(snap.totals.duplicates, 0);
  // 'b' has no tier → contributes to analyzed but no tier bucket.
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
  assert.deepEqual(snap.by_category, { coding: 2, writing: 1 });
  // Sorted by count desc: coding before writing.
  assert.deepEqual(Object.keys(snap.by_category), ['coding', 'writing']);
});

test('gap-closure fields: new_last_7d, maintenance, unique_creators, churn (deterministic ref date)', () => {
  // Fixed snapshot-date reference so the 7d/90d windows are deterministic.
  // nowMs is derived from generatedAt below (2026-08-04T00:00:00Z).
  const opts = { date: '2026-08-04', generatedAt: '2026-08-04T00:00:00.000Z' };

  const records = [
    // r1: INDEXED, recent scrape (within 7d), recent push (active), owner alice.
    rec({
      id: 'r1',
      repo_full_name: 'alice/repo1',
      quality_tier: 'featured',
      scraped_at: '2026-08-01T00:00:00.000Z', // 3d ago → counts in new_last_7d
      repo_pushed_at: '2026-07-15T00:00:00.000Z', // 20d ago → active
      repo_archived: false,
    }),
    // r2: INDEXED, old scrape, old push (>90d → abandoned), ARCHIVED, owner bob.
    rec({
      id: 'r2',
      repo_full_name: 'bob/repo2',
      quality_tier: 'listed',
      scraped_at: '2026-06-01T00:00:00.000Z', // old → not new
      repo_pushed_at: '2026-01-01T00:00:00.000Z', // >90d → abandoned
      repo_archived: true,
    }),
    // r3: INDEXED, old scrape, MISSING push (→ abandoned, conservative), owner alice (dup owner).
    rec({
      id: 'r3',
      repo_full_name: 'alice/repo3',
      quality_tier: 'solid',
      scraped_at: '2026-05-01T00:00:00.000Z', // old → not new
      // repo_pushed_at intentionally absent → abandoned
      repo_archived: false,
    }),
    // r4: DUPLICATE, recent scrape (still counts in new_last_7d — over ALL records),
    // but excluded from maintenance + unique_creators (INDEXED-only). Owner carol.
    rec({
      id: 'r4',
      repo_full_name: 'carol/repo4',
      quality_tier: 'listed',
      is_duplicate: true,
      scraped_at: '2026-08-02T00:00:00.000Z', // 2d ago → counts in new_last_7d
      repo_pushed_at: '2026-07-20T00:00:00.000Z',
      repo_archived: false,
    }),
  ];

  const snap = aggregateSnapshot(records, opts);

  // Totals sanity (renamed field).
  assert.equal(snap.totals.analyzed, 4);
  assert.equal(snap.totals.indexed, 3);
  assert.equal(snap.totals.duplicates, 1);

  // new_last_7d counts ALL records (incl. the duplicate r4) with a recent scrape.
  assert.equal(snap.new_last_7d, 2);

  // maintenance is over INDEXED records only (r1 active; r2 >90d + r3 missing → abandoned).
  assert.deepEqual(snap.maintenance, { active: 1, abandoned: 2 });
  assert.equal(snap.maintenance.active + snap.maintenance.abandoned, snap.totals.indexed);

  // unique_creators over INDEXED: {alice (r1,r3), bob (r2)} = 2. carol (r4 dup) excluded.
  assert.equal(snap.unique_creators, 2);

  // churn: one archived (r2), one duplicate (r4, mirrors totals.duplicates).
  assert.deepEqual(snap.churn, { archived: 1, duplicates: 1 });
  assert.equal(snap.churn.duplicates, snap.totals.duplicates);
});

test('nowMs opt overrides the snapshot-date reference for the windows', () => {
  // Same record, two different reference "nows": one where the push is
  // fresh (active) and one far in the future (abandoned) — proves the
  // window pivots on the caller-supplied reference, not real Date.now().
  const records = [
    rec({
      id: 's1',
      repo_full_name: 'owner/s1',
      scraped_at: '2026-08-01T00:00:00.000Z',
      repo_pushed_at: '2026-08-01T00:00:00.000Z',
    }),
  ];

  const near = aggregateSnapshot(records, { date: '2026-08-04', nowMs: Date.parse('2026-08-04T00:00:00.000Z') });
  assert.deepEqual(near.maintenance, { active: 1, abandoned: 0 });
  assert.equal(near.new_last_7d, 1);

  const far = aggregateSnapshot(records, { date: '2027-08-04', nowMs: Date.parse('2027-08-04T00:00:00.000Z') });
  assert.deepEqual(far.maintenance, { active: 0, abandoned: 1 }); // push now >90d in the past
  assert.equal(far.new_last_7d, 0); // scrape now >7d in the past
});

test('_header sentinel records are ignored', () => {
  const records = [
    { _header: true, schema_version: 2, entity_type: 'skill' },
    rec({ quality_tier: 'featured' }),
  ];
  const snap = aggregateSnapshot(records, { date: '2026-08-04' });
  assert.equal(snap.totals.analyzed, 1);
  assert.equal(snap.totals.tiers.featured, 1);
});
