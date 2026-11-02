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
 * (no repo), adoption 0 (consumed_by empty), freshness 0 (unknown).
 *
 * Exact-total derivation for a bare api record:
 *   access 0, reachability 70, docs 0, license 0, freshness 0, popularity 50,
 *   adoption 0 -> 0.15*70 + 0.15*50 = 10.5 + 7.5 = 18.
 *
 * NOTE: the mcp.scorer.test.js builder spreads `...overrides` AFTER the merged
 * `extra`, which clobbers it. This builder destructures `{ access, extra,
 * ...rest }` instead so per-test `extra` overrides merge rather than replace.
 *
 * Written test-first (D-07): RED with ERR_MODULE_NOT_FOUND until Plan 04
 * (access.js) and Plan 05 (feed.signals.js + api.scorer.js) land.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAccess, setAccessField } from '../../access.js';
import { FEED_WEIGHTS, NEUTRAL_REACHABILITY, NEUTRAL_POPULARITY } from '../feed.signals.js';
import { scoreApi } from '../api.scorer.js';
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

test('4.1-M05: bare api (all unknown, null repo) scores exactly 18 = neutral reachability + neutral popularity', () => {
  const r = bareApi();
  assert.equal(scoreApi(r), 18);
  assert.equal(r.extra.access_clarity, 0);
});

test('4.1-M05: source_modified_at today adds the full freshness signal (18 → 33)', () => {
  // scoreRecency(<=7d) = 100 -> +0.15*100 = +15
  assert.equal(scoreApi(bareApi({ extra: { source_modified_at: new Date().toISOString() } })), 33);
});

test('4.1-M05: freshness falls back to repo_pushed_at when a repo is known', () => {
  // repo_stars 0 -> popularity scoreStars(0)=0 (-7.5); repo_pushed_at now -> freshness +15.
  // 18 - 7.5 + 15 = 25.5 -> Math.round half-ambiguity, so assert the 25|26 band + ordering only.
  const s = scoreApi(bareApi({ repo_pushed_at: new Date().toISOString(), repo_stars: 0 }));
  assert.ok(s === 25 || s === 26, `expected 25 or 26, got ${s}`);
  assert.ok(s > scoreApi(bareApi({ repo_stars: 0 })));
});

test('4.1-M05: fully known access at confidence 1 sets extra.access_clarity = 1 and adds 20 points', () => {
  const acc = emptyAccess();
  setAccessField(acc, 'auth.type', 'bearer', { confidence: 1 });
  setAccessField(acc, 'cost.model', 'free', { confidence: 1 });
  acc.rate_limit.per = 'hour';
  setAccessField(acc, 'rate_limit.requests', 5000, { confidence: 1 });
  const r = bareApi({ access: acc });
  assert.equal(scoreApi(r), 38);
  assert.equal(r.extra.access_clarity, 1);
});

test('4.1-M05: docs signal — docs_url 40 + spec_url 40 + description 20 = +15 points', () => {
  // scoreFeedDocs = 40 (docs_url) + 40 (spec_url) + scoreDescription(60 chars)=100 * 0.2 = 100 -> +0.15*100
  const s = scoreApi(bareApi({
    docs_url: 'https://d',
    description: 'x'.repeat(60),
    extra: { spec_url: 'https://s/openapi.json' },
  }));
  assert.equal(s, 33);
});

test('4.1-M05: license — permissive SPDX 100, other declared 70, undeclared 0', () => {
  const permissive = scoreApi(bareApi({ access: { license: { spdx: 'MIT', name: null, url: null } } }));
  assert.equal(permissive, 33); // 18 + 0.15*100

  const other = scoreApi(bareApi({ access: { license: { spdx: null, name: 'lov2', url: null } } }));
  assert.ok(other === 28 || other === 29, `expected 28 or 29 (18 + 10.5), got ${other}`);

  const undeclared = scoreApi(bareApi());
  assert.equal(undeclared, 18);
});

test('4.1-M05: popularity uses GitHub stars only when a repo is known (1000 stars → 100 vs neutral 50)', () => {
  // scoreStars(1000) = 100 -> 0.15*100 = 15 vs neutral 7.5 -> 18 + 7.5 = 25.5 (round-half ambiguous)
  const s = scoreApi(bareApi({ repo_full_name: 'o/r', repo_stars: 1000 }));
  assert.ok(s === 25 || s === 26, `expected 25 or 26, got ${s}`);
  assert.ok(s > scoreApi(bareApi()));
});

test('4.1-M05: ecosystem adoption — 5 consumers saturate the 5% signal (+5)', () => {
  const s = scoreApi(bareApi({
    extra: { consumed_by: { skills: ['a', 'b', 'c'], plugins: ['d'], mcp_servers: ['e'] } },
  }));
  assert.equal(s, 23);
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
