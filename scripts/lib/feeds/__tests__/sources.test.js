/**
 * scripts/lib/feeds/__tests__/sources.test.js
 *
 * Phase 4.2 Plan 02 (4.2-M01 / 4.2-M02, D-10). RED until Plan 07 / Plan 06 land.
 *
 * Contract tests for the four pure source parsers (APIs.guru list.json,
 * data.gouv.fr dataservices page, UK co-cddo catalogue.csv, marcelscruz
 * public-apis resources.json) plus the text.js slug helper. Every assertion
 * is pinned to the real 2026-11-05 captures in data/__fixtures__/feeds/.
 *
 * No network: parsers take already-fetched bodies.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify, foldAccents } from '../text.js';
import {
  parseApisGuruList, apisGuruName, applySpec, markSpecUnparsed, LIST_URL, SOURCE as GURU,
} from '../sources/apis-guru.js';
import { parseDataGouvPage, dataGouvName, nextPageUrl, FIRST_PAGE_URL } from '../sources/data-gouv.js';
import { parseCsv, parseUkCatalogue, CSV_URL } from '../sources/uk-catalogue.js';
import { parsePublicApis, RESOURCES_URL } from '../sources/public-apis.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const FIX = join(ROOT, 'data', '__fixtures__', 'feeds');
const load = (name) => JSON.parse(readFileSync(join(FIX, name), 'utf-8'));
const loadText = (name) => readFileSync(join(FIX, name), 'utf-8');
const NOW = '2026-11-05T12:00:00Z';

/** Recursively assert that no value anywhere in `obj` is `undefined`. */
function assertNoUndefined(obj, path = '') {
  if (obj === undefined) {
    assert.fail(`undefined value at ${path || '<root>'}`);
  }
  if (obj === null || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => assertNoUndefined(v, `${path}[${i}]`));
    return;
  }
  for (const [k, v] of Object.entries(obj)) {
    assertNoUndefined(v, path ? `${path}.${k}` : k);
  }
}

const RAW_KEYS = ['entity_type', 'name', 'description', 'origin', 'home_url', 'docs_url', 'source', 'tags', 'scraped_at', 'content_sha', 'access', 'extra', 'raw_source'].sort();
const EXTRA_KEYS = ['base_urls', 'spec_url', 'spec_version', 'endpoint_count', 'categories_src', 'provider', 'source_modified_at', 'endpoint_summaries', 'spec_parsed'].sort();

function assertRawShape(r, source, kind) {
  assert.deepEqual(Object.keys(r).sort(), RAW_KEYS);
  assert.deepEqual(Object.keys(r.extra).sort(), EXTRA_KEYS);
  assert.equal(r.entity_type, 'api');
  assert.equal(r.origin.source, source);
  assert.equal(r.origin.kind, kind);
  assert.deepEqual(r.origin.also_listed_in, []);
  assert.equal(r.source, 'registry');
  assert.deepEqual(r.tags, []);
  assert.equal(r.scraped_at, NOW);
  assert.ok(/^[0-9a-f]{64}$/.test(r.content_sha), `content_sha ${r.content_sha}`);
  assert.deepEqual(r.access, {});
  assert.equal(r.extra.spec_parsed, false);
  assert.deepEqual(r.extra.endpoint_summaries, []);
  assert.ok(!('id' in r), 'parsers never set id');
  assertNoUndefined(r);
}

const byName = (recs, name) => recs.find((r) => r.name === name);

test('4.2-M01: slugify folds accents and punctuation', () => {
  assert.equal(slugify('API Melodi'), 'api-melodi');
  assert.equal(slugify('GOV.UK Notify'), 'gov-uk-notify');
  assert.equal(slugify('Données Radar'), 'donnees-radar');
  assert.equal(slugify('  --x--  '), 'x');
  assert.equal(foldAccents('é'), 'e');
});

test('4.2-M01: apisGuruName — serviceName when usable, else provider first label', () => {
  const cases = [
    [['stripe.com', { 'x-providerName': 'stripe.com' }], 'stripe'],
    [['github.com', { 'x-providerName': 'github.com', 'x-serviceName': 'api.github.com' }], 'github'],
    [['twilio.com:api', { 'x-providerName': 'twilio.com', 'x-serviceName': 'api' }], 'twilio'],
    [['adobe.com:aem', { 'x-providerName': 'adobe.com', 'x-serviceName': 'aem' }], 'aem'],
    [['azure.com:network-networkInterface', { 'x-providerName': 'azure.com', 'x-serviceName': 'network-networkInterface' }], 'network-networkinterface'],
    [['data.gov', { 'x-providerName': 'data.gov' }], 'data'],
  ];
  for (const [[key, info], expected] of cases) {
    assert.equal(apisGuruName(key, info), expected, key);
  }
});

test('4.2-M01: parseApisGuruList emits 7 raw records in the contract shape', () => {
  const recs = parseApisGuruList(load('apis-guru-list-slice.json'), { now: NOW });
  assert.equal(recs.length, 7);
  for (const r of recs) assertRawShape(r, 'apis.guru', 'registry');
  assert.deepEqual(recs.map((r) => r.name), ['stripe', 'data', 'aem', 'github', 'network-networkinterface', 'twilio', 'openai']);
  assert.equal(LIST_URL, 'https://api.apis.guru/v2/list.json');
  assert.equal(GURU, 'apis.guru');
});

test('4.2-M01: apis.guru field mapping on stripe/github/data.gov/openai', () => {
  const recs = parseApisGuruList(load('apis-guru-list-slice.json'), { now: NOW });
  const stripe = byName(recs, 'stripe');
  assert.equal(stripe.origin.source_id, 'stripe.com');
  assert.ok(stripe.origin.source_url.endsWith('/stripe.com/2022-11-15/openapi.json'), stripe.origin.source_url);
  assert.equal(stripe.home_url, 'https://stripe.com');
  assert.equal(stripe.docs_url, null);
  assert.equal(stripe.extra.spec_url, stripe.origin.source_url);
  assert.equal(stripe.extra.spec_version, '3.0.0');
  assert.deepEqual(stripe.extra.base_urls, []);
  assert.deepEqual(stripe.extra.categories_src, ['financial']);
  assert.equal(stripe.extra.provider, 'stripe.com');
  assert.equal(stripe.description.length, 77);
  assert.equal(stripe.raw_source.preferred, '2022-11-15');
  assert.equal(stripe.raw_source.x_unofficialSpec, false);
  assert.equal(stripe.raw_source.info_license, null);
  assert.equal(stripe.raw_source.updated, '2023-03-06T07:12:59.965Z');

  const github = byName(recs, 'github');
  assert.equal(github.home_url, 'https://support.github.com/contact?tags=dotcom-rest-api');
  assert.equal(github.docs_url, 'https://docs.github.com/rest/');
  assert.equal(github.raw_source.version_count, 2);
  assert.deepEqual(github.raw_source.info_license, { name: 'MIT', url: 'https://spdx.org/licenses/MIT' });

  const datagov = byName(recs, 'data');
  assert.equal(datagov.home_url, 'http://regulationsgov.github.io/developers/');
  assert.equal(datagov.extra.spec_version, '2.0');
  assert.deepEqual(datagov.extra.categories_src, []);

  const openai = byName(recs, 'openai');
  assert.equal(openai.home_url, 'https://openai.com/');
  assert.equal(openai.docs_url, null);

  const aem = byName(recs, 'aem');
  assert.equal(aem.raw_source.x_unofficialSpec, true);
});

test('4.2-M01/decision 8: frozen-snapshot guard nulls source_modified_at before 2024-01-01 but keeps raw_source.updated', () => {
  const recs = parseApisGuruList(load('apis-guru-list-slice.json'), { now: NOW });
  for (const r of recs) {
    assert.equal(r.extra.source_modified_at, null, r.name);
    assert.equal(typeof r.raw_source.updated, 'string', r.name);
  }
  const synthetic = {
    'x.com': {
      preferred: '1',
      added: '2025-01-01T00:00:00Z',
      versions: {
        1: {
          updated: '2025-02-01T00:00:00Z',
          swaggerUrl: 'https://api.apis.guru/v2/specs/x.com/1/openapi.json',
          openapiVer: '3.1.0',
          info: { 'x-providerName': 'x.com', title: 'X' },
        },
      },
    },
  };
  const [x] = parseApisGuruList(synthetic, { now: NOW });
  assert.equal(x.extra.source_modified_at, '2025-02-01T00:00:00Z');
});

test('4.2-M01: applySpec / markSpecUnparsed mutate the spec-derived fields only', () => {
  const fresh = () => byName(parseApisGuruList(load('apis-guru-list-slice.json'), { now: NOW }), 'stripe');
  const r = fresh();
  const out = applySpec(r, {
    spec_version: '3.0.0',
    base_urls: ['https://api.stripe.com/'],
    endpoint_count: 2,
    endpoint_summaries: ['GET /v1/account GetAccount', 'POST /v1/account_links PostAccountLinks'],
    external_docs_url: null,
  });
  assert.equal(out, r, 'returns the same object');
  assert.deepEqual(r.extra.base_urls, ['https://api.stripe.com/']);
  assert.equal(r.extra.endpoint_count, 2);
  assert.equal(r.extra.spec_parsed, true);
  assert.equal(r.extra.endpoint_summaries.length, 2);
  assert.equal(r.docs_url, null);
  assert.equal(r.name, 'stripe');
  assert.equal(r.origin.source, 'apis.guru');
  assert.equal(r.origin.source_id, 'stripe.com');

  const r2 = fresh();
  const out2 = markSpecUnparsed(r2, 'capped');
  assert.equal(out2, r2);
  assert.equal(r2.extra.spec_parsed, false);
  assert.equal(r2.raw_source.spec_skip_reason, 'capped');
  assert.deepEqual(r2.extra.base_urls, []);

  const r3 = fresh();
  applySpec(r3, { base_urls: [], endpoint_count: 0, endpoint_summaries: [], external_docs_url: 'https://d' });
  assert.equal(r3.docs_url, 'https://d');
  const github = byName(parseApisGuruList(load('apis-guru-list-slice.json'), { now: NOW }), 'github');
  applySpec(github, { base_urls: [], endpoint_count: 0, endpoint_summaries: [], external_docs_url: 'https://d' });
  assert.equal(github.docs_url, 'https://docs.github.com/rest/', 'non-null docs_url is not overwritten');
});

test('4.2-M01: dataGouvName strips ONE leading api- and nextPageUrl reads next_page', () => {
  assert.equal(dataGouvName('API Melodi'), 'melodi');
  assert.equal(dataGouvName('API Données Radar'), 'donnees-radar');
  assert.equal(dataGouvName('Explore API v2 https://data.eurelien.fr'), 'explore-api-v2-https-data-eurelien-fr');
  assert.equal(dataGouvName('API'), 'api');
  assert.equal(nextPageUrl({ next_page: 'https://x?page=2' }), 'https://x?page=2');
  assert.equal(nextPageUrl({ next_page: null }), null);
  assert.equal(FIRST_PAGE_URL, 'https://www.data.gouv.fr/api/1/dataservices/?page_size=200');
});

test('4.2-M01: parseDataGouvPage emits 6 raw records with portal origin and the declared fields in raw_source', () => {
  const recs = parseDataGouvPage(load('data-gouv-page.json'), { now: NOW });
  assert.equal(recs.length, 6);
  for (const r of recs) assertRawShape(r, 'data.gouv.fr', 'portal');
  assert.deepEqual(recs.map((r) => r.name), [
    'melodi', 'donnees-radar', 'bulletin-vigilance', 'explore-api-v2-https-data-eurelien-fr',
    'service-finances-publiques-sfip', 'croustillant',
  ]);

  const melodi = byName(recs, 'melodi');
  assert.equal(melodi.origin.source_id, 'api-melodi');
  assert.ok(melodi.origin.source_url.endsWith('/dataservices/api-melodi/'), melodi.origin.source_url);
  assert.equal(typeof melodi.home_url, 'string');
  assert.ok(melodi.home_url.includes('api-melodi'), melodi.home_url);
  assert.deepEqual(melodi.extra.base_urls, ['https://api.insee.fr/melodi/']);
  assert.equal(typeof melodi.extra.spec_url, 'string');
  assert.equal(melodi.extra.spec_parsed, false);
  assert.equal(melodi.extra.provider, 'institut-national-de-la-statistique-et-des-etudes-economiques-insee');
  assert.equal(melodi.extra.source_modified_at, '2026-11-05T13:21:25.919000+00:00');
  assert.equal(melodi.raw_source.access_type, 'open');
  assert.equal(melodi.raw_source.license, 'lov2');
  assert.ok(melodi.raw_source.rate_limiting.startsWith('20 interrogations'));

  const sfip = byName(recs, 'service-finances-publiques-sfip');
  assert.deepEqual(sfip.extra.base_urls, []);
  assert.equal(typeof sfip.extra.spec_url, 'string');

  const crous = byName(recs, 'croustillant');
  assert.equal(crous.extra.provider, 'paul-bayfield');
  assert.equal(crous.raw_source.organization, null);
  assert.deepEqual(crous.raw_source.owner, { slug: 'paul-bayfield' });

  const explore = recs.find((r) => r.origin.source_id === 'explore-api-v2-56');
  assert.equal(explore.description, '');
});

test('4.2-M01: parseDataGouvPage skips archived/deleted/private items', () => {
  const page = structuredClone(load('data-gouv-page.json'));
  page.data[0].archived_at = '2026-01-01T00:00:00Z';
  page.data[1].deleted_at = '2026-01-01T00:00:00Z';
  page.data[2].private = true;
  assert.equal(parseDataGouvPage(page, { now: NOW }).length, 3);
});

test('4.2-M01: parseCsv is RFC 4180 (quoted newlines, "" escapes, LF, no BOM)', () => {
  assert.deepEqual(
    parseCsv('a,b\n1,"x\ny"\n2,"he said ""hi"""\n'),
    [['a', 'b'], ['1', 'x\ny'], ['2', 'he said "hi"']],
  );
  const rows = parseCsv(loadText('uk-catalogue-10.csv'));
  assert.equal(rows.length, 11);
  for (const row of rows) assert.equal(row.length, 12);
  assert.equal(rows[0][0], 'dateAdded');
  assert.equal(rows[0][11], 'provider');
});

test('4.2-M01: parseUkCatalogue emits 10 raw records; multi-line description survives; empty url falls back', () => {
  const recs = parseUkCatalogue(loadText('uk-catalogue-10.csv'), { now: NOW });
  assert.equal(recs.length, 10);
  for (const r of recs) assertRawShape(r, 'uk-api-catalogue', 'registry');
  const names = recs.map((r) => r.name);
  for (const n of ['gov-uk-notify', 'bank-holidays', 'access-control-service-hl7-v3-api', 'get-into-teaching-api', 'findr-matching-service', 'os-maps-api', 'lginform-plus']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }

  const nhs = byName(recs, 'access-control-service-hl7-v3-api');
  assert.ok(nhs.description.includes('\n'));
  assert.equal(nhs.description.length, 648);

  const notify = byName(recs, 'gov-uk-notify');
  assert.deepEqual(notify.extra.base_urls, ['https://api.notifications.service.gov.uk/']);
  assert.equal(notify.home_url, 'https://api.notifications.service.gov.uk/');
  assert.equal(notify.docs_url, 'https://www.notifications.service.gov.uk/documentation');
  assert.equal(notify.extra.provider, 'government-digital-service');
  assert.equal(notify.extra.source_modified_at, '2020-08-24T00:00:00Z');
  assert.equal(notify.origin.source_id, 'https://api.notifications.service.gov.uk/');
  assert.equal(notify.origin.source_url, CSV_URL + '#' + encodeURIComponent('GOV.UK Notify'));

  const git = byName(recs, 'get-into-teaching-api');
  assert.deepEqual(git.extra.base_urls, []);
  assert.equal(git.home_url, 'https://github.com/DFE-Digital/get-into-teaching-api');
  assert.equal(git.origin.source_id, 'Get into Teaching API');

  const findr = byName(recs, 'findr-matching-service');
  assert.equal(findr.home_url, '');
  assert.equal(findr.docs_url, null);
  assert.equal(findr.raw_source.license, 'ISC');

  const os = byName(recs, 'os-maps-api');
  assert.equal(os.raw_source.license, 'https://osdatahub.os.uk/legal/termsConditions');

  for (const r of recs) assert.equal(r.extra.spec_url, null, r.name);
});

test('4.2-M01: parsePublicApis emits 10 raw records with base_urls = [Link] (decision 2)', () => {
  const json = load('public-apis-10.json');
  const recs = parsePublicApis(json, { now: NOW });
  assert.equal(recs.length, 10);
  for (const r of recs) assertRawShape(r, 'public-apis', 'registry');
  assert.deepEqual(recs.map((r) => r.name), [
    'cat-facts', 'github', 'openai', 'stripe', 'open-food-facts', 'apexverify', 'clarifai', 'meteorologisk-institutt',
    slugify(json.entries[8].API), slugify(json.entries[9].API),
  ]);

  const cat = byName(recs, 'cat-facts');
  assert.deepEqual(cat.extra.base_urls, ['https://catfact.ninja/']);
  assert.equal(cat.home_url, 'https://catfact.ninja/');
  assert.equal(cat.docs_url, null);
  assert.equal(cat.extra.provider, 'catfact.ninja');
  assert.deepEqual(cat.extra.categories_src, ['Animals']);
  assert.equal(cat.origin.source_id, 'Cat Facts');
  assert.equal(cat.origin.source_url, RESOURCES_URL);
  assert.equal(cat.raw_source.Auth, '');
  assert.equal(cat.raw_source.Cors, 'yes');
  assert.equal(cat.extra.source_modified_at, null);

  const gh = byName(recs, 'github');
  assert.equal(gh.extra.provider, 'docs.github.com');
  assert.equal(gh.raw_source.Auth, 'OAuth');

  const apex = byName(recs, 'apexverify');
  assert.equal(apex.raw_source.Auth, 'X-Mashape-Key');
});

function parseAll(now) {
  return [
    ...parseApisGuruList(load('apis-guru-list-slice.json'), { now }),
    ...parseDataGouvPage(load('data-gouv-page.json'), { now }),
    ...parseUkCatalogue(loadText('uk-catalogue-10.csv'), { now }),
    ...parsePublicApis(load('public-apis-10.json'), { now }),
  ];
}

test('4.2-M01: content_sha is stable and per-source distinct', () => {
  const a = parseAll(NOW).map((r) => r.content_sha);
  const b = parseAll(NOW).map((r) => r.content_sha);
  const c = parseAll('2030-01-01T00:00:00Z').map((r) => r.content_sha);
  assert.deepEqual(a, b);
  assert.deepEqual(a, c, 'now does not feed content_sha');
  assert.equal(a.length, 33);
  assert.equal(new Set(a).size, 33);
});

test('4.2-M01: no undefined anywhere; every missing source value is null', () => {
  const all = parseAll(NOW);
  assert.equal(all.length, 33);
  for (const r of all) assertNoUndefined(r);

  const [pub] = parsePublicApis({ count: 1, entries: [{ API: 'No Desc', Auth: '', Cors: 'no', Link: 'https://nodesc.example/', Category: 'Test' }] }, { now: NOW });
  assert.equal(pub.description, '');
  assertNoUndefined(pub);

  const page = structuredClone(load('data-gouv-page.json'));
  page.data = [page.data[0]];
  page.data[0].organization = null;
  page.data[0].owner = null;
  const [gouv] = parseDataGouvPage(page, { now: NOW });
  assert.equal(gouv.extra.provider, 'data.gouv.fr');
  assert.equal(gouv.raw_source.organization, null);
  assertNoUndefined(gouv);
});
