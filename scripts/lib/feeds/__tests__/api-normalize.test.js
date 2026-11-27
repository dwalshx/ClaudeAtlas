/**
 * scripts/lib/feeds/__tests__/api-normalize.test.js — API calibration v1
 * (2026-11-18): description clean-up, catalog titles, the public-apis cost
 * migration, and stable slugs across filter runs. `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanDescription, rawApiTitle, migratePublicApisCost, normalizeRawApi } from '../api-normalize.js';
import { PUBLIC_APIS_FREE_TIER_NOTE } from '../api-access.js';
import { restorePriorSlugs } from '../../../filter-apis.js';
import { isSlop } from '../../filter-rules/index.js';

test('cleanDescription: literal \\n (UK CSV), markdown escapes (data.gouv.fr), autolinks; idempotent', () => {
  assert.equal(cleanDescription('Send emails.\\n\\nThe API contains:\\n\\n- a REST API'), 'Send emails.\n\nThe API contains:\n\n- a REST API');
  assert.equal(cleanDescription('Horaires \\: 8h\\-18h, voir \\[la doc\\]'), 'Horaires : 8h-18h, voir [la doc]');
  assert.equal(cleanDescription('Catalogue (<https://catalogue-donnees.insee.fr/fr>)'), 'Catalogue (https://catalogue-donnees.insee.fr/fr)');
  assert.equal(cleanDescription('a\r\n\r\n\r\n\r\nb  \n'), 'a\n\nb');
  const once = cleanDescription('x \\: y\\n<https://a.b/c>');
  assert.equal(cleanDescription(once), once);
  assert.equal(cleanDescription(null), '');
  assert.equal(cleanDescription('Plain text, nothing to do.'), 'Plain text, nothing to do.');
});

test('rawApiTitle: each source keeps its human title in a different raw_source key', () => {
  assert.equal(rawApiTitle({ origin: { source: 'apis.guru' }, raw_source: { title: '1Forge Finance APIs' } }), '1Forge Finance APIs');
  assert.equal(rawApiTitle({ origin: { source: 'data.gouv.fr' }, raw_source: { title: '  API   Melodi ' } }), 'API Melodi');
  assert.equal(rawApiTitle({ origin: { source: 'uk-api-catalogue' }, raw_source: { name: 'GOV.UK Notify' } }), 'GOV.UK Notify');
  assert.equal(rawApiTitle({ origin: { source: 'public-apis' }, raw_source: { API: 'Cat Facts' } }), 'Cat Facts');
  assert.equal(rawApiTitle({ origin: { source: 'public-apis' }, raw_source: {} }), null);
  assert.equal(rawApiTitle({ origin: { source: 'nope' }, raw_source: { title: 'x' } }), null);
});

const declaredFree = () => ({
  cost: { model: 'free', free_tier: null, price_notes: null },
  provenance: { 'cost.model': { method: 'declared', source_url: 'https://raw/resources.json', confidence: 0.7, checked_at: '2026-11-07T00:00:00Z' } },
});

test('migratePublicApisCost: a pre-v1 public-apis "free" becomes unknown + heuristic free_tier; other sources untouched', () => {
  const rec = { origin: { source: 'public-apis' }, access: declaredFree() };
  migratePublicApisCost(rec);
  assert.equal(rec.access.cost.model, 'unknown');
  assert.equal(rec.access.cost.free_tier, PUBLIC_APIS_FREE_TIER_NOTE);
  assert.ok(!('cost.model' in rec.access.provenance));
  assert.deepEqual(rec.access.provenance['cost.free_tier'], { method: 'heuristic', source_url: 'https://raw/resources.json', confidence: 0.5, checked_at: '2026-11-07T00:00:00Z' });

  const gouv = { origin: { source: 'data.gouv.fr' }, access: declaredFree() };
  migratePublicApisCost(gouv);
  assert.equal(gouv.access.cost.model, 'free', 'government catalogs stay declared free');
});

test('normalizeRawApi: does not mutate its input; sets extra.title and cleans the description', () => {
  const raw = { origin: { source: 'public-apis' }, description: 'Facts \\: cats', raw_source: { API: 'Cat Facts' }, extra: { base_urls: [] }, access: declaredFree() };
  const before = structuredClone(raw);
  const out = normalizeRawApi(raw);
  assert.deepEqual(raw, before);
  assert.equal(out.description, 'Facts : cats');
  assert.equal(out.extra.title, 'Cat Facts');
  assert.equal(out.access.cost.model, 'unknown');
});

test('restorePriorSlugs: a published slug survives a new collision; a slug another record now holds is not stolen', () => {
  // assignSlugs() moved BOTH colliders to the 3-segment form; the old record gets its URL back.
  const records = [
    { id: 'api:api.languagetoolplus.com/languagetool', slug: 'languagetool.org/api.languagetoolplus.com/languagetool' },
    { id: 'api:languagetool.org/languagetool', slug: 'languagetool.org/languagetool.org/languagetool' },
  ];
  const prior = new Map([['api:api.languagetoolplus.com/languagetool', { slug: 'languagetool.org/languagetool' }]]);
  assert.equal(restorePriorSlugs(records, prior), 1);
  assert.equal(records[0].slug, 'languagetool.org/languagetool');
  assert.equal(records[1].slug, 'languagetool.org/languagetool.org/languagetool');

  const held = [{ id: 'a', slug: 'p/x' }, { id: 'b', slug: 'p/y' }];
  assert.equal(restorePriorSlugs(held, new Map([['b', { slug: 'p/x' }]])), 0);
  assert.deepEqual(held.map((r) => r.slug), ['p/x', 'p/y']);
});

test('filter-rules: api names are exempt from BIZ_SLOP_PATTERNS; skills are not', () => {
  const base = { description: 'x'.repeat(80), home_url: 'https://h', extra: { base_urls: ['https://h'] } };
  assert.equal(isSlop({ ...base, entity_type: 'api', name: 'logistics-api' }), false);
  assert.equal(isSlop({ ...base, entity_type: 'api', name: 'asset-management' }), false);
  assert.equal(isSlop({ entity_type: 'skill', name: 'asset-management', description: 'x'.repeat(300) }), true);
});
