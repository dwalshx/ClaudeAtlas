/**
 * scripts/lib/scorers/__tests__/dataset.scorer.test.js
 *
 * Phase 4.1 Plan 02 (4.1-M05 / D-06). Executable contract for the dataset
 * 7-signal data-feed scorer (uncalibrated). Shares FEED_WEIGHTS + neutral
 * defaults with the api scorer; differs in:
 *   - freshness uses scoreDatasetFreshness (365-day cliff) instead of the
 *     skill scoreRecency (180-day cliff)
 *   - docs signal reads extra.schema_url (Croissant / DCAT schema) as the
 *     spec-equivalent
 *   - source popularity metrics (downloads/views/likes/citations) are
 *     collected but NOT scored in 4.1 — source-normalised percentiles are 4.5
 *
 * Bare dataset total: 0.15*70 + 0.15*50 = 18 (same derivation as api).
 * 100 days ago: dataset bucket 75 -> 18 + 11.25 = 29.25 -> 29.
 *
 * Builder destructures `{ access, extra, ...rest }` (does NOT copy the
 * mcp.scorer.test.js `...overrides`-after-extra clobber).
 *
 * Written test-first (D-07): RED with ERR_MODULE_NOT_FOUND until Plan 04
 * (access.js) and Plan 05 (feed.signals.js + dataset.scorer.js) land.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAccess } from '../../access.js';
import { scoreDatasetFreshness } from '../feed.signals.js';
import { scoreDataset } from '../dataset.scorer.js';
import { scoreApi } from '../api.scorer.js';
import { scoreEntity } from '../index.js';

const daysAgo = (d) => new Date(Date.now() - d * 86400000).toISOString();

function bareDataset(overrides = {}) {
  // Everything unknown/absent except what the test sets.
  const { access, extra, ...rest } = overrides;
  return {
    entity_type: 'dataset',
    name: 'archi-v2',
    description: '',
    home_url: 'https://zenodo.org/records/23888170',
    docs_url: null,
    repo_full_name: null,
    repo_stars: null,
    repo_pushed_at: null,
    repo_license: null,
    access: { ...emptyAccess(), ...(access || {}) },
    extra: {
      type: 'dataset',
      download_urls: ['https://z/x.zip'],
      schema_url: null,
      spec_url: null,
      publisher: 'zenodo',
      popularity: { downloads: null, views: null, likes: null, citations: null, window: null },
      source_modified_at: null,
      consumed_by: { skills: [], plugins: [], mcp_servers: [] },
      ...(extra || {}),
    },
    ...rest,
  };
}

function bareApi(overrides = {}) {
  const { access, extra, ...rest } = overrides;
  return {
    entity_type: 'api',
    name: 'stripe',
    description: '',
    home_url: 'https://stripe.com',
    docs_url: null,
    repo_full_name: null,
    repo_stars: null,
    repo_pushed_at: null,
    repo_license: null,
    access: { ...emptyAccess(), ...(access || {}) },
    extra: {
      type: 'api',
      base_urls: ['https://api.stripe.com/'],
      spec_url: null,
      schema_url: null,
      provider: 'stripe.com',
      source_modified_at: null,
      consumed_by: { skills: [], plugins: [], mcp_servers: [] },
      ...(extra || {}),
    },
    ...rest,
  };
}

test('4.1-M05: bare dataset scores exactly 18', () => {
  const r = bareDataset();
  assert.equal(scoreDataset(r), 18);
  assert.equal(r.extra.access_clarity, 0);
});

test('4.1-M05: scoreDatasetFreshness uses the 365-day cliff buckets', () => {
  assert.equal(scoreDatasetFreshness(null), 0);
  assert.equal(scoreDatasetFreshness(daysAgo(10)), 100);
  assert.equal(scoreDatasetFreshness(daysAgo(60)), 90);
  assert.equal(scoreDatasetFreshness(daysAgo(100)), 75);
  assert.equal(scoreDatasetFreshness(daysAgo(300)), 50);
  assert.equal(scoreDatasetFreshness(daysAgo(500)), 25);
  assert.equal(scoreDatasetFreshness(daysAgo(900)), 5);
});

test('4.1-M05: a dataset modified 100 days ago outscores an api modified 100 days ago (365d vs 180d cliff)', () => {
  // dataset: bucket 75 -> 18 + 0.15*75 = 29.25 -> 29
  assert.equal(scoreDataset(bareDataset({ extra: { source_modified_at: daysAgo(100) } })), 29);
  // api: scoreRecency bucket 50 -> 18 + 7.5 = 25.5 (round-half ambiguous) -> ordering only
  assert.ok(29 > scoreApi(bareApi({ extra: { source_modified_at: daysAgo(100) } })));
});

test('4.1-M05: docs signal reads schema_url for datasets', () => {
  const s = scoreDataset(bareDataset({
    docs_url: 'https://d',
    description: 'x'.repeat(60),
    extra: { schema_url: 'https://h/croissant' },
  }));
  assert.equal(s, 33);
});

test('4.1-M05: dataset popularity is neutral 50 without a repo (source-normalised percentiles are 4.5)', () => {
  // Downloads/likes are carried on extra.popularity but do NOT move the 4.1 score.
  const s = scoreDataset(bareDataset({
    extra: {
      popularity: { downloads: 1213121, views: null, likes: 1236, citations: null, window: 'all_time' },
    },
  }));
  assert.equal(s, 18);
});

test('4.1-M05: scoreDataset returns a 0-100 integer; dispatcher routes entity_type=dataset', () => {
  const s = scoreDataset(bareDataset());
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 100, `got ${s}`);

  let minimal;
  assert.doesNotThrow(() => { minimal = scoreDataset({ entity_type: 'dataset' }); });
  assert.ok(Number.isInteger(minimal) && minimal >= 0 && minimal <= 100, `got ${minimal}`);

  assert.equal(scoreEntity(bareDataset()), scoreDataset(bareDataset()));
});
