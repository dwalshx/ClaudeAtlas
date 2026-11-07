/**
 * scripts/__tests__/filter-apis.test.js
 *
 * Phase 4.2 Plan 03 (4.2-M07 / 4.2-M08, D-05). RED until Plans 09 + 10 land.
 *
 * End-to-end tests for filterApisRaw over the raw set produced by an
 * in-process harvestApis() run against the shared fixtureFetch (no network):
 * 33 raw → 30 merged → 21 kept, tiers 2/6/13, the dropped-names table,
 * PRESERVED_FIELDS carry-over (incl. nested extra.consumed_by), pre-flight
 * floors, id collisions and the pipeline-stats `api` section shape.
 *
 * Never imports the Astro-side entity loader. `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  filterApisRaw, preflight, countBySource, dropReason, accessClarityHistogram, loadPriorEnrichments,
  MIN_API_RAW, PRESERVED_FIELDS,
} from '../filter-apis.js';
import { harvestApis } from '../harvest-apis.js';
import { makeFixtureFetch } from '../lib/feeds/__tests__/helpers/fixture-fetch.js';
import { readNdjsonRecords, writeNdjsonStreaming } from '../lib/ndjson.js';
import { buildHeader } from '../lib/entity-version.js';
import { emptyAccess } from '../lib/access.js';

const NOW = () => '2026-11-05T12:00:00Z';

async function runFixtureHarvest(dir, extra = {}) {
  const { fetch: fetchOpts, ...rest } = extra;
  return harvestApis({
    fetchImpl: makeFixtureFetch(fetchOpts).fetchImpl,
    now: NOW,
    outPath: join(dir, 'apis-raw.ndjson'),
    partialPath: join(dir, 'apis-raw.ndjson.partial'),
    sidecarPath: join(dir, 'feeds-etag-cache.ndjson'),
    enforceFloors: false,
    log: () => {},
    ...rest,
  });
}

const HARVEST_DIR = mkdtempSync(join(tmpdir(), 'feeds-'));
let RAW;
try {
  RAW = (await runFixtureHarvest(HARVEST_DIR)).records;
} finally {
  rmSync(HARVEST_DIR, { recursive: true, force: true });
}

const byName = (records, name) => records.find((r) => r.name === name);

test('4.2-M07: filterApisRaw on the fixture raw set — 33 raw → 30 merged → 21 kept, tiers 2/6/13', () => {
  const { records, tiers, stats } = filterApisRaw(structuredClone(RAW));
  assert.equal(stats.total_raw, 33);
  assert.equal(stats.total_merged, 30);
  assert.equal(stats.total_apis, 21);
  assert.equal(records.length, 21);
  assert.deepEqual(tiers, { featured: 2, solid: 6, listed: 13 });
  assert.deepEqual(stats.merged_duplicates, { cross_source: 3, same_source: 0 });
  assert.deepEqual(stats.by_source, {
    'apis.guru': { raw: 7, kept: 5 },
    'data.gouv.fr': { raw: 6, kept: 5 },
    'uk-api-catalogue': { raw: 10, kept: 8 },
    'public-apis': { raw: 10, kept: 3 },
  });
  for (const r of records) {
    assert.equal(r.entity_type, 'api');
    assert.equal(r.schema_version, 2);
    assert.ok(Number.isInteger(r.quality_score) && r.quality_score >= 0 && r.quality_score <= 100, `${r.id} ${r.quality_score}`);
    assert.equal(typeof r.extra.access_clarity, 'number');
    assert.ok(['featured', 'solid', 'listed'].includes(r.quality_tier), r.quality_tier);
    assert.equal(r.repo_stars, null);
    assert.ok(r.tags[0].startsWith('category:'), `${r.id} ${r.tags[0]}`);
  }
});

test('4.2-M07/Pitfall 7: dropped table names every record and gate', () => {
  const { records, stats } = filterApisRaw(structuredClone(RAW));
  assert.deepEqual(stats.dropped, {
    fixture_repo: 0, template_name: 0, placeholder_description: 0, biz_slop: 0,
    short_description: 7, no_home_url: 1, no_base_or_spec: 1,
  });
  assert.deepEqual([...stats.dropped_names.short_description].sort(), [
    'apis.guru:github', 'apis.guru:twilio', 'data.gouv.fr:explore-api-v2-https-data-eurelien-fr',
    'public-apis:cat-facts', 'public-apis:clarifai', 'public-apis:meteorologisk-institutt', 'public-apis:open-food-facts',
  ]);
  assert.deepEqual(stats.dropped_names.no_home_url, ['uk-api-catalogue:findr-matching-service']);
  assert.deepEqual(stats.dropped_names.no_base_or_spec, ['uk-api-catalogue:get-into-teaching-api']);
  assert.equal(dropReason({ entity_type: 'api', name: 'inventory-sync', description: 'x'.repeat(60), home_url: 'https://h', extra: { base_urls: ['https://h'] } }), 'biz_slop');
  assert.equal(dropReason(records[0]), null);
});

test('4.2-M07: merge + upcast — winners carry also_listed_in and merged access; ids and slugs are provider/name', () => {
  const { records, stats } = filterApisRaw(structuredClone(RAW));
  const stripe = byName(records, 'stripe');
  assert.deepEqual(stripe.origin.also_listed_in, ['public-apis']);
  assert.equal(stripe.slug, 'stripe.com/stripe');
  assert.equal(stripe.access.auth.type, 'http_basic');
  assert.equal(stripe.access.cost.model, 'free');
  assert.equal(stripe.access.provenance['cost.model'].method, 'declared');

  const openai = byName(records, 'openai');
  assert.equal(openai.slug, 'openai.com/openai');
  assert.deepEqual(openai.origin.also_listed_in, ['public-apis']);

  const melodi = byName(records, 'melodi');
  assert.equal(melodi.slug, 'institut-national-de-la-statistique-et-des-etudes-economiques-insee/melodi');
  assert.equal(melodi.id, 'api:api.insee.fr/melodi');

  assert.equal(byName(records, 'gov-uk-notify').slug, 'government-digital-service/gov-uk-notify');

  for (const r of records) assert.ok(!r.slug.includes('undefined'), r.slug);
  assert.equal(new Set(records.map((r) => r.slug)).size, 21);
  assert.equal(new Set(records.map((r) => r.id)).size, 21);
  assert.equal(stats.id_collisions, 0);
  assert.ok(!('raw_source' in records[0]));
  assert.deepEqual(Object.keys(records[0].extra).sort(), [
    'access_clarity', 'base_urls', 'categories_src', 'consumed_by', 'endpoint_count', 'endpoint_summaries',
    'provider', 'sdks', 'spec_parsed', 'spec_url', 'spec_version', 'source_modified_at', 'status_page_url', 'type',
  ].sort());
});

test('4.2-M07: scoring — frozen guru records get neutral freshness, data.gouv.fr records beat them on freshness', () => {
  const { records } = filterApisRaw(structuredClone(RAW));
  const stripe = byName(records, 'stripe');
  assert.ok(Number.isInteger(stripe.quality_score));
  const top = [...records].sort((a, b) => b.quality_score - a.quality_score)[0];
  assert.equal(top.origin.source, 'data.gouv.fr');
  assert.ok(stripe.extra.access_clarity > 0);
});

test('4.2-M07/F-3: PRESERVED_FIELDS round-trip incl. nested extra.consumed_by', () => {
  const prior = new Map([[
    'api:api.stripe.com/stripe',
    {
      is_duplicate: true,
      canonical_id: 'api:x',
      canonical_slug: 'x/y',
      novelty_score: 0.12,
      bundled_in_plugins: ['plugin:o/r/.claude-plugin/plugin.json'],
      consumed_by: { skills: ['s1'], plugins: [], mcp_servers: [] },
    },
  ]]);
  const { records } = filterApisRaw(structuredClone(RAW), prior);
  const stripe = records.find((r) => r.id === 'api:api.stripe.com/stripe');
  assert.equal(stripe.is_duplicate, true);
  assert.equal(stripe.canonical_slug, 'x/y');
  assert.equal(stripe.novelty_score, 0.12);
  assert.deepEqual(stripe.bundled_in_plugins, ['plugin:o/r/.claude-plugin/plugin.json']);
  assert.deepEqual(stripe.extra.consumed_by, { skills: ['s1'], plugins: [], mcp_servers: [] });

  const other = records.find((r) => r.id !== 'api:api.stripe.com/stripe');
  assert.equal(other.is_duplicate, false);
  assert.deepEqual(other.extra.consumed_by, { skills: [], plugins: [], mcp_servers: [] });

  assert.deepEqual(PRESERVED_FIELDS, ['is_duplicate', 'canonical_id', 'canonical_slug', 'novelty_score', 'bundled_in_plugins']);

  const dir = mkdtempSync(join(tmpdir(), 'feeds-'));
  try {
    const p = join(dir, 'apis.ndjson');
    writeNdjsonStreaming(p, records, { header: buildHeader('api') });
    const loaded = loadPriorEnrichments(p);
    assert.ok(loaded instanceof Map);
    const e = loaded.get('api:api.stripe.com/stripe');
    assert.equal(e.is_duplicate, true);
    assert.equal(e.canonical_slug, 'x/y');
    assert.deepEqual(e.consumed_by, { skills: ['s1'], plugins: [], mcp_servers: [] });
    assert.equal(loaded.has(other.id), false, 'records with nothing to preserve are omitted');
    assert.equal(readNdjsonRecords(p).size, 21);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('4.2-M07/D-05: preflight floors — below MIN_API_RAW and zero-source both throw FATAL; countBySource', () => {
  assert.throws(() => preflight(RAW), /FATAL: only 33 raw records \(expected >= 1000\)/);
  const guruOnly = Array.from({ length: 1000 }, (_, i) => ({ entity_type: 'api', name: `n${i}`, origin: { source: 'apis.guru', source_id: `k${i}` } }));
  assert.throws(() => preflight(guruOnly), /FATAL: source data\.gouv\.fr returned 0/);
  const sources = ['apis.guru', 'data.gouv.fr', 'uk-api-catalogue', 'public-apis'];
  const spread = Array.from({ length: 1000 }, (_, i) => ({ entity_type: 'api', name: `n${i}`, origin: { source: sources[i % 4], source_id: `k${i}` } }));
  assert.deepEqual(preflight(spread), { 'apis.guru': 250, 'data.gouv.fr': 250, 'uk-api-catalogue': 250, 'public-apis': 250 });
  assert.equal(MIN_API_RAW, 1000);
  assert.deepEqual(countBySource(RAW), { 'apis.guru': 7, 'data.gouv.fr': 6, 'uk-api-catalogue': 10, 'public-apis': 10 });
});

function collisionRaw(source, sourceId, host) {
  return {
    id: 'api:acme/weather',
    entity_type: 'api',
    name: 'weather',
    description: 'Weather forecasts and observations for every region, updated hourly.',
    origin: { kind: 'registry', source, source_id: sourceId, source_url: `https://${host}/src`, also_listed_in: [] },
    home_url: `https://${host}/`,
    docs_url: null,
    source: 'registry',
    tags: [],
    scraped_at: '2026-11-05T12:00:00Z',
    content_sha: (source === 'apis.guru' ? 'a' : 'b').repeat(64),
    access: emptyAccess(),
    extra: {
      base_urls: [],
      spec_url: `https://${host}/openapi.json`,
      spec_version: null,
      endpoint_count: null,
      categories_src: [],
      provider: 'acme',
      source_modified_at: null,
      endpoint_summaries: [],
      spec_parsed: false,
    },
    raw_source: { shape: source },
  };
}

test('4.2-M08: stats object shape', () => {
  const { stats } = filterApisRaw(structuredClone(RAW));
  assert.deepEqual(Object.keys(stats).sort(), [
    'access_clarity_histogram', 'by_source', 'dropped', 'dropped_names', 'id_collisions',
    'merged_duplicates', 'tiers', 'total_apis', 'total_merged', 'total_raw',
  ]);
  assert.equal(stats.id_collisions, 0);

  const pair = [collisionRaw('apis.guru', 'acme.example:weather', 'a.example'), collisionRaw('public-apis', 'Weather', 'b.example')];
  const res = filterApisRaw(pair);
  assert.equal(res.stats.id_collisions, 1);
  const ids = res.records.map((r) => r.id).sort();
  assert.equal(new Set(ids).size, 2);
  assert.equal(res.records.find((r) => r.origin.source === 'apis.guru').id, 'api:acme/weather');
  assert.equal(res.records.find((r) => r.origin.source === 'public-apis').id, 'api:acme/weather~public-apis-weather');

  assert.equal(stats.access_clarity_histogram.length, 10);
  assert.equal(stats.access_clarity_histogram.reduce((a, b) => a + b, 0), 21);
  assert.deepEqual(
    accessClarityHistogram([{ extra: { access_clarity: 0 } }, { extra: { access_clarity: 1 } }, { extra: { access_clarity: 0.95 } }, { extra: { access_clarity: 0.1 } }]),
    [1, 1, 0, 0, 0, 0, 0, 0, 0, 2],
  );
});

test('4.2-M07: determinism — two runs produce identical output (ids, slugs, tiers, scores)', () => {
  assert.equal(
    JSON.stringify(filterApisRaw(structuredClone(RAW)).records),
    JSON.stringify(filterApisRaw(structuredClone(RAW)).records),
  );
});
