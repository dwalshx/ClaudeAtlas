/**
 * scripts/__tests__/generate-registry.test.js — Phase 4.3.
 *
 * The registry stays skills-only; api data adds an optional top-level `apis`
 * summary block. buildApisBlock() is the pure piece (main() needs
 * data/skills.ndjson, so it is not exercised here — the Phase 4.1 round-trip
 * test covers buildRegistryEntry).
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApisBlock } from '../generate-registry.js';

test('4.3: buildApisBlock returns null with no api data (key omitted from registry)', () => {
  assert.equal(buildApisBlock(null), null);
  assert.equal(buildApisBlock(undefined), null);
  assert.equal(buildApisBlock({ count: 0, tiers: { featured: 0, solid: 0, listed: 0 } }), null);
});

test('4.3: buildApisBlock carries count, tiers, index/search/bulk-download pointers', () => {
  const block = buildApisBlock({ count: 4223, tiers: { featured: 422, solid: 1266, listed: 2535 } });
  assert.equal(block.count, 4223);
  assert.equal(block.total_featured, 422);
  assert.equal(block.total_solid, 1266);
  assert.equal(block.total_listed, 2535);
  assert.equal(block.index_url, 'https://claudeatlas.com/apis/');
  assert.equal(block.detail_url_template, 'https://claudeatlas.com/apis/{slug}/');
  assert.equal(block.search_api_url, 'https://claudeatlas.com/api/v1/search?type=api');
  assert.equal(
    block.bulk_download_url,
    'https://github.com/dwalshx/ClaudeAtlas/releases/download/apis-latest/apis.ndjson',
  );
  assert.equal(block.methodology_url, 'https://claudeatlas.com/methodology/#data-feed-scoring');
  assert.equal(typeof block.note, 'string');
});

test('4.3: buildApisBlock tolerates a summary without tiers', () => {
  const block = buildApisBlock({ count: 3 });
  assert.equal(block.count, 3);
  assert.equal(block.total_featured, 0);
  assert.equal(block.total_solid, 0);
  assert.equal(block.total_listed, 0);
});
