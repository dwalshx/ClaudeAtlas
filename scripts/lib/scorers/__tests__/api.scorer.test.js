/**
 * scripts/lib/scorers/__tests__/api.scorer.test.js
 *
 * Phase 4.1 Plan 02 (4.1-M05 / D-06). Executable contract for the api
 * 7-signal data-feed scorer (uncalibrated — weights from the spec table,
 * neutral defaults where the inputs do not exist yet):
 *
 *   access 0.20 | reachability 0.15 | docs 0.15 | license 0.15
 *   freshness 0.15 | popularity 0.15 | adoption 0.05
 *
 * Neutral defaults (D-06): reachability 70 (no probe history), popularity 50
 * (no repo), adoption 0 (consumed_by empty). Phase 4.2 decision 8: freshness
 * with no source_modified_at and no repo_pushed_at is NEUTRAL 50 for api
 * (APIs.guru is a frozen 2023 snapshot; the harvester nulls pre-2024 dates).
 *
 * Exact-total derivation for a bare api record (re-pinned 4.2 decision 8):
 *   access 0, reachability 70, docs 0, license 0, freshness 50, popularity 50,
 *   adoption 0 -> 0.15*70 + 0.15*50 + 0.15*50 = 10.5 + 7.5 + 7.5 = 25.5
 *   -> Math.round half-ambiguity, so bare-derived pins assert a 25|26 band.
 *
 * NOTE: the mcp.scorer.test.js builder spreads `...overrides` AFTER the merged
 * `extra`, which clobbers it. This builder destructures `{ access, extra,
 * ...rest }` instead so per-test `extra` overrides merge rather than replace.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAccess, setAccessField } from '../../access.js';
import { FEED_WEIGHTS, NEUTRAL_REACHABILITY, NEUTRAL_POPULARITY, NEUTRAL_FRESHNESS } from '../feed.signals.js';
import { scoreApi } from '../api.scorer.js';
import { scoreDataset } from '../dataset.scorer.js';
import { scoreEntity } from '../index.js';

function bareApi(overrides = {}) {
  // Everything unknown/absent except what the test sets.
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

function bareDataset() {
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
    access: emptyAccess(),
    extra: {
      type: 'dataset',
      download_urls: ['https://z/x.zip'],
      schema_url: null,
      spec_url: null,
      publisher: 'zenodo',
      popularity: { downloads: null, views: null, likes: null, citations: null, window: null },
      source_modified_at: null,
      consumed_by: { skills: [], plugins: [], mcp_servers: [] },
    },
  };
}

const band = (s, a, b) => assert.ok(s === a || s === b, `expected ${a} or ${b}, got ${s}`);

test('4.1-M05: FEED_WEIGHTS sum to 1.00 and match the spec table', () => {
  assert.ok(Math.abs(Object.values(FEED_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.deepEqual(FEED_WEIGHTS, {
    access: 0.20,
    reachability: 0.15,
    docs: 0.15,
    license: 0.15,
    freshness: 0.15,
    popularity: 0.15,
    adoption: 0.05,
  });
  assert.equal(NEUTRAL_REACHABILITY, 70);
  assert.equal(NEUTRAL_POPULARITY, 50);
});

test('4.1-M05: bare api (all unknown, null repo) scores 25|26 = neutral reachability + popularity + freshness (re-pinned 4.2 decision 8)', () => {
  const r = bareApi();
  band(scoreApi(r), 25, 26);
  assert.equal(r.extra.access_clarity, 0);
});

test('4.1-M05: source_modified_at today adds the full freshness signal (→ 33)', () => {
  // 10.5 + 7.5 + 0.15*100 = 33 (freshness known, so unchanged by decision 8)
  assert.equal(scoreApi(bareApi({ extra: { source_modified_at: new Date().toISOString() } })), 33);
});

test('4.1-M05: freshness falls back to repo_pushed_at when a repo is known', () => {
  // repo_stars 0 -> popularity scoreStars(0)=0; repo_pushed_at now -> freshness 100.
  // 10.5 + 0 + 15 = 25.5 -> 25|26 band + ordering (vs freshness-unknown 10.5 + 0 + 7.5 = 18).
  const s = scoreApi(bareApi({ repo_pushed_at: new Date().toISOString(), repo_stars: 0 }));
  band(s, 25, 26);
  assert.ok(s > scoreApi(bareApi({ repo_stars: 0 })));
});

test('4.1-M05: fully known access at confidence 1 sets extra.access_clarity = 1 and adds 20 points (re-pinned 4.2 decision 8)', () => {
  const acc = emptyAccess();
  setAccessField(acc, 'auth.type', 'bearer', { confidence: 1 });
  setAccessField(acc, 'cost.model', 'free', { confidence: 1 });
  acc.rate_limit.per = 'hour';
  setAccessField(acc, 'rate_limit.requests', 5000, { confidence: 1 });
  const r = bareApi({ access: acc });
  band(scoreApi(r), 45, 46); // 25.5 + 20
  assert.equal(r.extra.access_clarity, 1);
});

test('4.1-M05: docs signal — docs_url 40 + spec_url 40 + description 20 = +15 points (re-pinned 4.2 decision 8)', () => {
  // scoreFeedDocs = 40 (docs_url) + 40 (spec_url) + scoreDescription(60 chars)=100 * 0.2 = 100 -> +0.15*100
  const s = scoreApi(bareApi({
    docs_url: 'https://d',
    description: 'x'.repeat(60),
    extra: { spec_url: 'https://s/openapi.json' },
  }));
  band(s, 40, 41); // 25.5 + 15
});

test('4.1-M05: license — permissive SPDX 100, other declared 70, undeclared 0 (re-pinned 4.2 decision 8)', () => {
  const permissive = scoreApi(bareApi({ access: { license: { spdx: 'MIT', name: null, url: null } } }));
  band(permissive, 40, 41); // 25.5 + 0.15*100

  const other = scoreApi(bareApi({ access: { license: { spdx: null, name: 'lov2', url: null } } }));
  assert.equal(other, 36); // 25.5 + 10.5

  const undeclared = scoreApi(bareApi());
  band(undeclared, 25, 26);
});

test('4.1-M05: popularity uses GitHub stars only when a repo is known (1000 stars → 100 vs neutral 50) (re-pinned 4.2 decision 8)', () => {
  // repo known but repo_pushed_at null -> freshness input null -> neutral 50.
  // 10.5 + 0.15*100 + 7.5 = 33
  const s = scoreApi(bareApi({ repo_full_name: 'o/r', repo_stars: 1000 }));
  assert.equal(s, 33);
  assert.ok(s > scoreApi(bareApi()));
});

test('4.1-M05: ecosystem adoption — 5 consumers saturate the 5% signal (+5) (re-pinned 4.2 decision 8)', () => {
  const s = scoreApi(bareApi({
    extra: { consumed_by: { skills: ['a', 'b', 'c'], plugins: ['d'], mcp_servers: ['e'] } },
  }));
  band(s, 30, 31); // 25.5 + 5
});

test('4.1-M05: scoreApi returns a 0-100 integer and never throws on null repo_*', () => {
  for (const r of [bareApi(), bareApi({ repo_full_name: null, repo_stars: null, repo_pushed_at: null })]) {
    const s = scoreApi(r);
    assert.ok(Number.isInteger(s) && s >= 0 && s <= 100, `got ${s}`);
  }
  // No access block, no extra: must not throw, must still return an integer.
  let minimal;
  assert.doesNotThrow(() => { minimal = scoreApi({ entity_type: 'api' }); });
  assert.ok(Number.isInteger(minimal) && minimal >= 0 && minimal <= 100, `got ${minimal}`);
});

test('4.1-M05: dispatcher routes entity_type=api to scoreApi', () => {
  assert.equal(scoreEntity(bareApi()), scoreApi(bareApi()));
});

test('4.2/decision 8: unknown freshness is neutral (50) for api — a stale 2020 date scores LOWER than unknown; dataset is unaffected', () => {
  const unknown = scoreApi(bareApi());
  const stale = scoreApi(bareApi({ extra: { source_modified_at: '2020-01-01T00:00:00Z' } }));
  assert.ok(stale < unknown, `stale ${stale} should be < unknown ${unknown}`);
  const diff = unknown - stale; // 7.5 - 0.75 = 6.75
  assert.ok(diff === 6 || diff === 7, `expected 6 or 7, got ${diff}`);
  assert.equal(NEUTRAL_FRESHNESS, 50);
  assert.equal(scoreDataset(bareDataset()), 18);
});
