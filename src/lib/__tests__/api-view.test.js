/**
 * src/lib/__tests__/api-view.test.js — Phase 4.3 presentation helpers for
 * api records. `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAccess, setAccessField } from '../../../scripts/lib/access.js';
import { scoreApi } from '../../../scripts/lib/scorers/api.scorer.js';
import {
  accessRows, scoreRows, provenanceFor, rateLimitLabel, costLabel, authLabel,
  licenseLabel, primaryHost, providerName, cardFacts, compareApis, visibleApis, sourceLabel,
  decodeEntities, diverseTop, apiDisplayName, withApiSuffix, sortKeyName,
} from '../api-view.js';

test('decodeEntities: numeric, hex and named entities decode; unknown ones and plain text pass through', () => {
  assert.equal(decodeEntities("L&#39;API permet"), "L'API permet");
  assert.equal(decodeEntities('caf&#xE9; &amp; th&eacute;'), 'café & th&eacute;');
  assert.equal(decodeEntities('a &lt;b&gt; &quot;c&quot;'), 'a <b> "c"');
  assert.equal(decodeEntities('no entities'), 'no entities');
  assert.equal(decodeEntities(null), '');
});

test('diverseTop: round-robins across origin.source so one catalog cannot fill the grid', () => {
  const mk = (id, source, score) => ({ id, name: id, slug: `p/${id}`, quality_score: score, origin: { source } });
  const recs = [mk('g1', 'data.gouv.fr', 90), mk('g2', 'data.gouv.fr', 89), mk('g3', 'data.gouv.fr', 88), mk('a1', 'apis.guru', 70), mk('u1', 'uk-api-catalogue', 60)];
  assert.deepEqual(diverseTop(recs, 4).map((r) => r.id), ['g1', 'a1', 'u1', 'g2']);
  assert.deepEqual(diverseTop(recs, 10).map((r) => r.id).length, 5);
  assert.deepEqual(diverseTop([], 3), []);
});

function api(over = {}) {
  return {
    id: 'api:api.example.com/example', entity_type: 'api', slug: 'example.com/example', name: 'Example',
    description: 'An example API used by the tests.', home_url: 'https://example.com', docs_url: null,
    origin: { kind: 'registry', source: 'apis.guru', source_id: 'example.com', source_url: null, also_listed_in: [] },
    access: emptyAccess(), extra: { base_urls: ['https://api.example.com/v1'], provider: 'example.com' },
    quality_score: 50, quality_tier: 'solid', is_duplicate: false, ...over,
  };
}

test('unknown is explicit: an empty access block yields five rows, every value null', () => {
  const rows = accessRows(emptyAccess());
  assert.deepEqual(rows.map((r) => r.key), ['cost', 'rate_limit', 'auth', 'license', 'formats']);
  assert.ok(rows.every((r) => r.value === null && r.provenance === null));
  assert.equal(costLabel(emptyAccess()), null, "cost.model 'unknown' must not render as a label");
  assert.equal(authLabel(emptyAccess()), null);
  assert.doesNotThrow(() => accessRows(undefined));
});

test('known fields render labels with provenance chips (exact key and rate_limit/license prefix match)', () => {
  const a = emptyAccess();
  setAccessField(a, 'auth.type', 'api_key', { method: 'spec', confidence: 0.95, source_url: 'https://x/spec.json' });
  setAccessField(a, 'rate_limit.requests', 100, { method: 'declared', confidence: 0.9 });
  setAccessField(a, 'rate_limit.per', 'minute', { method: 'declared', confidence: 0.9 });
  setAccessField(a, 'license.spdx', 'MIT', { method: 'spec', confidence: 0.9 });
  const rows = Object.fromEntries(accessRows(a).map((r) => [r.key, r]));
  assert.equal(rows.auth.value, 'API key');
  assert.equal(rows.auth.provenance.method, 'spec');
  assert.equal(rows.auth.provenance.confidencePct, 95);
  assert.equal(rows.rate_limit.value, '100 requests / minute');
  assert.equal(rows.rate_limit.provenance.method, 'declared');
  assert.equal(rows.license.value, 'MIT');
  assert.equal(rows.license.provenance.method, 'spec');
  assert.equal(provenanceFor(a, 'cost.model'), null);
});

test('rate limit falls back to the declared free-text note, trimmed and capped', () => {
  const a = emptyAccess();
  a.rate_limit.notes = '  20 interrogations par seconde  ';
  assert.equal(rateLimitLabel(a), '20 interrogations par seconde');
  a.rate_limit.notes = 'x'.repeat(500);
  assert.equal(rateLimitLabel(a).length, 140);
});

test('scoreRows: seven signals in display order, weights sum to 100, placeholders flagged, total matches scoreApi', () => {
  const r = api();
  const rows = scoreRows(r);
  assert.deepEqual(rows.map((x) => x.key), ['access', 'reachability', 'docs', 'license', 'freshness', 'popularity', 'adoption']);
  assert.equal(rows.reduce((s, x) => s + x.weightPct, 0), 100);
  assert.ok(rows.find((x) => x.key === 'reachability').placeholder);
  assert.equal(rows.find((x) => x.key === 'docs').placeholder, null);
  const weighted = Math.round(rows.reduce((s, x) => s + x.value * x.weightPct / 100, 0));
  assert.ok(Math.abs(weighted - scoreApi(api())) <= 1, `${weighted} vs ${scoreApi(api())}`);
});

test('host/provider/label helpers are null-safe', () => {
  assert.equal(primaryHost(api()), 'api.example.com');
  assert.equal(primaryHost(api({ extra: { base_urls: ['not a url'] }, home_url: 'https://home.example.org/x' })), 'home.example.org');
  assert.equal(primaryHost({}), null);
  assert.equal(providerName(api()), 'example.com');
  assert.equal(providerName({ slug: 'acme.io/thing' }), 'acme.io');
  assert.equal(licenseLabel(undefined), null);
  assert.equal(sourceLabel('uk-api-catalogue'), 'UK API Catalogue');
  assert.equal(sourceLabel('somewhere-new'), 'somewhere-new');
});

test('listing helpers: duplicates and slugless records hidden; sort is score desc then name then id', () => {
  const recs = [
    api({ id: 'a', slug: 'p/a', name: 'B', quality_score: 40 }),
    api({ id: 'b', slug: 'p/b', name: 'A', quality_score: 40 }),
    api({ id: 'c', slug: 'p/c', name: 'Z', quality_score: 90 }),
    api({ id: 'd', slug: 'p/d', is_duplicate: true }),
    api({ id: 'e', slug: '' }),
  ];
  const vis = visibleApis(recs).sort(compareApis);
  assert.deepEqual(vis.map((r) => r.id), ['c', 'b', 'a']);
  assert.deepEqual(visibleApis(undefined), []);
  const a = emptyAccess();
  a.cost.model = 'free';
  a.auth.type = 'none';
  assert.deepEqual(cardFacts({ access: a }), ['Free', 'No auth']);
});

test('calibration v1: display name prefers the catalog title; page titles never say "API API"; A–Z key drops a leading API', () => {
  assert.equal(apiDisplayName({ name: 'melodi', extra: { title: 'API Melodi' } }), 'API Melodi');
  assert.equal(apiDisplayName({ name: 'melodi', extra: { title: '  ' } }), 'melodi');
  assert.equal(apiDisplayName({ name: 'L&#39;API', extra: {} }), "L'API");
  assert.equal(withApiSuffix('Stripe'), 'Stripe API');
  assert.equal(withApiSuffix('Stripe API'), 'Stripe API');
  assert.equal(withApiSuffix('1Forge Finance APIs'), '1Forge Finance APIs');
  assert.equal(sortKeyName('API Données Radar'), 'Donnees Radar');
  assert.equal(sortKeyName('APIs: Zebra'), 'Zebra');
  assert.equal(sortKeyName('API'), 'API');
  assert.equal(sortKeyName('Rapid API'), 'Rapid API');
});
