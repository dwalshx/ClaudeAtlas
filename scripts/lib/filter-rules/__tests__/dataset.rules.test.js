/**
 * scripts/lib/filter-rules/__tests__/dataset.rules.test.js
 *
 * Phase 4.1 Plan 02 (4.1-M07 / D-06). dataset slop gates:
 *   - entity_type guard (non-dataset records never rejected by this pack)
 *   - MIN_DESCRIPTION_LENGTH (50) via common hasShortDescription
 *   - HAS_HOME_URL (home_url non-empty)
 *   - HAS_DOWNLOAD_OR_LANDING (extra.download_urls.length >= 1 OR home_url)
 *     — a landing page alone is enough; many portal datasets expose files
 *     only behind the landing page.
 * No star gate (Phase 3.1 precedent). Common gates still run first via the
 * index.js isSlop dispatcher.
 *
 * Written test-first (D-07): RED with ERR_MODULE_NOT_FOUND until Plan 06
 * creates scripts/lib/filter-rules/dataset.rules.js.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDatasetSlop } from '../dataset.rules.js';
import { isSlop } from '../index.js';

function baseDataset(top = {}, extra = {}) {
  return {
    entity_type: 'dataset',
    name: 'archi-v2',
    description: 'ARCHI v2: an annotated architectural floor-plan dataset with vector polygons and room labels.',
    home_url: 'https://zenodo.org/records/23888170',
    docs_url: null,
    repo_full_name: null,
    ...top,
    extra: {
      type: 'dataset',
      download_urls: ['https://zenodo.org/api/records/23888170/files/archi-v2.zip/content'],
      publisher: 'zenodo',
      ...extra,
    },
  };
}

test('4.1-M07: valid dataset (home_url + download_url + long description) passes', () => {
  assert.equal(isDatasetSlop(baseDataset()), false);
});

test('4.1-M07: missing home_url is rejected (HAS_HOME_URL)', () => {
  assert.equal(isDatasetSlop(baseDataset({ home_url: '' })), true);
});

test('4.1-M07: landing page alone satisfies HAS_DOWNLOAD_OR_LANDING (empty download_urls passes when home_url is set)', () => {
  assert.equal(isDatasetSlop(baseDataset({}, { download_urls: [] })), false);
});

test('4.1-M07: short description (<50) is rejected', () => {
  assert.equal(isDatasetSlop(baseDataset({ description: 'Floor plans' })), true);
});

test('4.1-M07: entity_type guard — non-dataset record is never rejected by the dataset pack', () => {
  assert.equal(isDatasetSlop({ entity_type: 'api', name: 'x', description: '' }), false);
});

test('4.1-M07: isSlop dispatches entity_type=dataset', () => {
  assert.equal(isSlop(baseDataset()), false);
  assert.equal(isSlop(baseDataset({ home_url: '' })), true);
});

test('4.1 Pitfall 8 (calibration note for 4.5): biz-slop prefix list rejects realistic data-domain names', () => {
  // DOCUMENTS CURRENT BEHAVIOUR — NOT AN ENDORSEMENT. common.rules.js
  // BIZ_SLOP_PATTERNS was calibrated against AI-generated skill names
  // (`energy-`, `inventory-`, `logistics-`, ... prefixes). Those prefixes
  // are perfectly ordinary dataset / api names (energy-consumption,
  // inventory-levels, logistics-shipments). Phase 4.5 calibrates the
  // common gates per entity_type against real harvests; until then this
  // test pins the status quo so the change is deliberate when it lands.
  assert.equal(isSlop(baseDataset({ name: 'energy-consumption' })), true);
});
