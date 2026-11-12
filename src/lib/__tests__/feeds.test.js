/**
 * src/lib/__tests__/feeds.test.js
 *
 * Phase 4.2 Plan 03 (4.2-M11 / D-07). RED until Plan 11 lands. Never imports
 * the Astro-side skills entity loader (it throws without data/skills.ndjson).
 *
 * Contract for src/lib/feeds.js: an optional-file loader for data/apis.ndjson
 * (empty when absent, header filtered, keyed by id) plus a pure
 * makeFeedsIndex(records) used for the module's own singletons. Lookups do
 * NOT filter duplicates.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadApisFrom, getApis, getApiById, getApiBySlug, makeFeedsIndex } from '../feeds.js';
import { writeNdjsonStreaming } from '../../../scripts/lib/ndjson.js';
import { buildHeader } from '../../../scripts/lib/entity-version.js';

const RECS = [
  { id: 'api:a/x', slug: 'a/x', entity_type: 'api', is_duplicate: true },
  { id: 'api:b/y', slug: 'b/y', entity_type: 'api' },
  { id: 'api:c/z', slug: 'c/z', entity_type: 'api' },
];

test('4.2-M11: loadApisFrom returns [] when apis.ndjson is absent and never throws', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
  try {
    assert.deepEqual(loadApisFrom(dir), []);
    assert.doesNotThrow(() => loadApisFrom('/definitely/missing'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('4.2-M11: loadApisFrom reads N records from a tmp dir, header filtered, keyed by id', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
  try {
    writeNdjsonStreaming(join(dir, 'apis.ndjson'), RECS, { header: buildHeader('api') });
    const loaded = loadApisFrom(dir);
    assert.equal(loaded.length, 3);
    for (const r of loaded) assert.ok(!('_header' in r));
    assert.deepEqual(loaded.map((r) => r.id), ['api:a/x', 'api:b/y', 'api:c/z']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('4.2-M11: module-level getters degrade to empty in this checkout and lookups return null on miss; duplicates are NOT filtered', () => {
  assert.ok(Array.isArray(getApis()));
  assert.equal(getApiById('api:nope/x'), null);
  assert.equal(getApiBySlug('nope/x'), null);

  const idx = makeFeedsIndex(RECS);
  assert.equal(idx.getApiBySlug('a/x').is_duplicate, true);
  assert.equal(idx.getApiById('api:b/y').slug, 'b/y');
  assert.equal(idx.getApis().length, 3);
  assert.equal(idx.getApiById('api:nope/x'), null);
});
