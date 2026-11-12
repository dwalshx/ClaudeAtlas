/**
 * scripts/lib/feeds/__tests__/api-access.test.js
 *
 * Phase 4.2 Plan 02 (4.2-M06 / D-04 + orchestrator decisions 4, 5). RED until Plan 06 lands.
 *
 * Contract tests for the access-block builders: security-scheme mapping and
 * precedence (decision 5), SPDX license mapping, media-type whitelist, the
 * rate-limit parser against the 99-row oracle captured from the 1,281 live
 * data.gouv.fr dataservices (decision 4), and the spec / declared ladder
 * steps with their exact confidences (D-04, decision 2).
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  mapScheme, mapSecuritySchemes, mapLicense, mediaTypesToFormats, parseRateLimit,
  accessFromSpec, accessForRecord, publicApisAuth, AUTH_PRECEDENCE, COST_FREE_SOURCES,
} from '../api-access.js';
import { extractOpenApi } from '../openapi-extract.js';
import { accessClarity, emptyAccess } from '../../access.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const FIX = join(ROOT, 'data', '__fixtures__', 'feeds');
const load = (name) => JSON.parse(readFileSync(join(FIX, name), 'utf-8'));
const AT = '2026-11-05T12:00:00Z';
const SPEC_URL = 'https://api.apis.guru/v2/specs/stripe.com/2022-11-15/openapi.json';
const prov = (a, path) => a.provenance[path];

function raw(source, raw_source, source_url = 'https://src') {
  return {
    entity_type: 'api',
    origin: { kind: 'registry', source, source_id: 'x', source_url, also_listed_in: [] },
    raw_source,
    extra: { base_urls: [] },
  };
}

test('4.2-M06: mapScheme table', () => {
  assert.equal(mapScheme({ type: 'apiKey' }), 'api_key');
  assert.equal(mapScheme({ type: 'http', scheme: 'bearer' }), 'bearer');
  assert.equal(mapScheme({ type: 'http', scheme: 'Basic' }), 'http_basic');
  assert.equal(mapScheme({ type: 'oauth2' }), 'oauth2');
  assert.equal(mapScheme({ type: 'openIdConnect' }), 'openid');
  assert.equal(mapScheme({ type: 'http', scheme: 'digest' }), 'unknown');
  assert.equal(mapScheme({ type: 'mutualTLS' }), 'unknown');
  assert.equal(mapScheme(null), 'unknown');
  assert.deepEqual(AUTH_PRECEDENCE, ['api_key', 'bearer', 'oauth2', 'http_basic', 'openid']);
});

test('4.2-M06/decision 5: global security requirement wins, else precedence; schemes lists all declared', () => {
  const stripe = extractOpenApi(load('openapi3-stripe-trimmed.json'));
  assert.deepEqual(mapSecuritySchemes(stripe.security), { type: 'http_basic', schemes: ['http_basic', 'bearer'] });

  assert.deepEqual(
    mapSecuritySchemes({ schemes: { b: { type: 'http', scheme: 'bearer' }, o: { type: 'oauth2' }, k: { type: 'apiKey' } }, requirements: [] }),
    { type: 'api_key', schemes: ['bearer', 'oauth2', 'api_key'] },
  );
  assert.deepEqual(
    mapSecuritySchemes({ schemes: { o: { type: 'oauth2' }, b: { type: 'http', scheme: 'bearer' } }, requirements: [{ zz: [] }] }),
    { type: 'bearer', schemes: ['oauth2', 'bearer'] },
    'requirement naming an undeclared scheme falls back to precedence',
  );
  assert.deepEqual(mapSecuritySchemes({ schemes: {}, requirements: [] }), { type: 'none', schemes: [] });
  assert.deepEqual(mapSecuritySchemes({ schemes: { m: { type: 'mutualTLS' } }, requirements: [] }), { type: 'none', schemes: [] });

  const datagov = extractOpenApi(load('swagger2-datagov.json'));
  assert.deepEqual(mapSecuritySchemes(datagov.security), { type: 'api_key', schemes: ['api_key'] });
});

test('4.2-M06: mapLicense SPDX name map, spdx.org URL detection, URL-only input, free text', () => {
  assert.deepEqual(mapLicense({ name: 'MIT', url: 'https://spdx.org/licenses/MIT' }), { spdx: 'MIT', name: 'MIT', url: 'https://spdx.org/licenses/MIT' });
  assert.equal(mapLicense({ name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0.html' }).spdx, 'Apache-2.0');
  assert.deepEqual(mapLicense('lov2'), { spdx: 'etalab-2.0', name: 'lov2', url: null });
  assert.equal(mapLicense('odc-odbl').spdx, 'ODbL-1.0');
  assert.equal(mapLicense('cc-by').spdx, 'CC-BY-4.0');
  assert.equal(mapLicense('Open Government Licence').spdx, 'OGL-UK-3.0');
  assert.equal(mapLicense('ISC').spdx, 'ISC');
  assert.deepEqual(
    mapLicense('https://osdatahub.os.uk/legal/termsConditions'),
    { spdx: null, name: null, url: 'https://osdatahub.os.uk/legal/termsConditions' },
  );
  assert.deepEqual(
    mapLicense('Subscription required see https://lginformplus.org/'),
    { spdx: null, name: 'Subscription required see https://lginformplus.org/', url: null },
  );
  assert.deepEqual(mapLicense(null), { spdx: null, name: null, url: null });
  assert.equal(mapLicense({ name: 'Creative Commons Attribution 3.0' }).spdx, 'CC-BY-3.0');
});

test('4.2-M06/Pitfall 9: mediaTypesToFormats whitelist drops */* and typos, maps +json/+xml suffixes, dedupes', () => {
  assert.deepEqual(
    mediaTypesToFormats([
      'application/json', 'applicaiton/xml', '*/*', 'application/json; charset=utf-8', 'text/xml',
      'application/vnd.api+json', 'application/pdf', 'image/png', 'application/octet-stream', 'text/csv',
      'application/geo+json', 'text/html',
    ]),
    ['json', 'xml', 'pdf', 'image', 'binary', 'csv', 'geojson', 'html'],
  );
  assert.deepEqual(mediaTypesToFormats([]), []);
  assert.deepEqual(mediaTypesToFormats(null), []);
});

test('4.2-M06/decision 4: parseRateLimit reproduces the 99-row oracle (61 parsed / 38 null)', () => {
  const rows = load('rate-limit-strings.json');
  for (const row of rows) {
    assert.deepEqual(parseRateLimit(row.raw), { requests: row.requests, per: row.per }, row.raw);
  }
  assert.ok(rows.filter((r) => r.requests !== null).length === 61);
  assert.equal(rows.length, 99);
});

test('4.2-M06: parseRateLimit specifics', () => {
  const cases = [
    ['60 req/min', 60, 'minute'],
    ['1000 requêtes/min par IP.', 1000, 'minute'],
    ['10 appels / seconde / IP', 10, 'second'],
    ['120 par minute', 120, 'minute'],
    ['15 requêtes par heure', 15, 'hour'],
    ['10 requêtes par jour avec une clé gratuite', 10, 'day'],
    ['100 000 requêtes par mois', 100000, 'month'],
    ['1,000 requests per day', 1000, 'day'],
  ];
  for (const [input, requests, per] of cases) {
    assert.deepEqual(parseRateLimit(input), { requests, per }, input);
  }
  for (const input of ['850 req/5mins', '600 requêtes par fenêtre de 60 secondes', 'illimité', '300', '-', '', null, 42]) {
    assert.deepEqual(parseRateLimit(input), { requests: null, per: null }, String(input));
  }
});

test('4.2-M06: accessFromSpec (stripe) — auth/schemes/transport at 0.9, formats at 0.8, provenance method spec', () => {
  const a = accessFromSpec(extractOpenApi(load('openapi3-stripe-trimmed.json')), SPEC_URL, AT);
  assert.equal(a.auth.type, 'http_basic');
  assert.deepEqual(a.auth.schemes, ['http_basic', 'bearer']);
  assert.deepEqual(a.formats, ['json']);
  assert.equal(a.transport, 'rest');
  assert.ok(a.license.spdx === null && a.license.name === null);
  assert.equal(a.cost.model, 'unknown');
  assert.deepEqual(prov(a, 'auth.type'), { method: 'spec', source_url: SPEC_URL, confidence: 0.9, checked_at: AT });
  assert.equal(prov(a, 'auth.schemes').confidence, 0.9);
  assert.equal(prov(a, 'formats').confidence, 0.8);
  assert.equal(prov(a, 'transport').method, 'spec');
  assert.ok(!('license.spdx' in a.provenance));
  assert.deepEqual(Object.keys(a).sort(), Object.keys(emptyAccess()).sort());
});

test('4.2-M06: accessFromSpec (data.gov Swagger 2) — api_key, formats [json] only, no license', () => {
  const a = accessFromSpec(extractOpenApi(load('swagger2-datagov.json')), 'https://api.apis.guru/v2/specs/data.gov/3.0/swagger.json', AT);
  assert.equal(a.auth.type, 'api_key');
  assert.deepEqual(a.formats, ['json']);
  assert.equal(a.license.name, null);

  const b = accessFromSpec({ security: { schemes: {}, requirements: [] }, media_types: [], license: { name: 'MIT' }, transport: 'rest' }, SPEC_URL, AT);
  assert.equal(b.auth.type, 'none');
  assert.deepEqual(b.auth.schemes, []);
  assert.equal(b.license.spdx, 'MIT');
  assert.equal(prov(b, 'license.spdx').confidence, 0.9);
  assert.deepEqual(b.formats, []);
  assert.ok(!('formats' in b.provenance));
});

test('4.2-M06: accessForRecord data.gouv.fr — notes always, parsed numbers when matched, access_type → auth, license 0.9, cost free 0.7', () => {
  const items = load('data-gouv-page.json').data;
  const gouv = (slug) => {
    const item = items.find((i) => i.slug === slug);
    const rec = raw('data.gouv.fr', {
      access_type: item.access_type ?? null,
      rate_limiting: item.rate_limiting ?? null,
      license: item.license ?? null,
    }, item.self_api_url);
    return { item, a: accessForRecord(rec, AT) };
  };

  {
    const { item, a } = gouv('api-bulletin-vigilance');
    assert.equal(a.rate_limit.requests, 60);
    assert.equal(a.rate_limit.per, 'minute');
    assert.equal(a.rate_limit.notes, '60 req/min');
    assert.equal(prov(a, 'rate_limit.requests').confidence, 0.8);
    assert.equal(prov(a, 'rate_limit.notes').method, 'declared');
    assert.equal(a.auth.type, 'api_key');
    assert.equal(prov(a, 'auth.type').confidence, 0.7);
    assert.equal(a.license.spdx, 'etalab-2.0');
    assert.equal(a.license.name, 'lov2');
    assert.equal(prov(a, 'license.spdx').confidence, 0.9);
    assert.equal(a.cost.model, 'free');
    assert.equal(prov(a, 'cost.model').confidence, 0.7);
    assert.equal(prov(a, 'cost.model').source_url, item.self_api_url);
  }
  {
    const { a } = gouv('api-melodi');
    assert.equal(a.auth.type, 'none');
    assert.equal(a.rate_limit.requests, null);
    assert.ok(a.rate_limit.notes.startsWith('20 interrogations'));
    const c = accessClarity(a);
    assert.ok(c > 0 && c < 1, `clarity ${c}`);
  }
  {
    const { a } = gouv('explore-api-v2-56');
    assert.equal(a.auth.type, 'api_key');
    assert.equal(a.rate_limit.notes, null);
    assert.ok(!('rate_limit.notes' in a.provenance));
    assert.equal(a.license.spdx, null);
  }
  {
    const { a } = gouv('api-service-finances-publiques-sfip');
    assert.equal(a.rate_limit.requests, null);
    assert.equal(typeof a.rate_limit.notes, 'string');
  }
});

test('4.2-M06: accessForRecord uk-api-catalogue — license URL vs name at 0.8, cost free 0.7, auth stays unknown', () => {
  const uk = (license) => accessForRecord(raw('uk-api-catalogue', { license }), AT);
  const os = uk('https://osdatahub.os.uk/legal/termsConditions');
  assert.equal(os.license.url, 'https://osdatahub.os.uk/legal/termsConditions');
  assert.equal(os.license.spdx, null);
  assert.equal(prov(os, 'license.url').confidence, 0.8);

  const findr = uk('ISC');
  assert.equal(findr.license.spdx, 'ISC');
  assert.equal(findr.license.name, 'ISC');

  const notify = uk('');
  assert.ok(notify.license.spdx === null && !('license.name' in notify.provenance));

  for (const a of [os, findr, notify]) {
    assert.equal(a.cost.model, 'free');
    assert.equal(prov(a, 'cost.model').confidence, 0.7);
    assert.equal(a.auth.type, 'unknown');
    assert.equal(a.rate_limit.notes, null);
  }
});

test('4.2-M06: accessForRecord public-apis — Auth map at 0.6, cost free 0.7, base_urls provenance declared 0.5 (decision 2)', () => {
  assert.equal(publicApisAuth(''), 'none');
  assert.equal(publicApisAuth('apiKey'), 'api_key');
  assert.equal(publicApisAuth('OAuth'), 'oauth2');
  assert.equal(publicApisAuth('X-Mashape-Key'), 'api_key');
  assert.equal(publicApisAuth('User-Agent'), 'none');
  assert.equal(publicApisAuth('weird'), 'unknown');

  const entry = load('public-apis-10.json').entries.find((e) => e.API === 'Cat Facts');
  const rec = { ...raw('public-apis', { ...entry }, 'https://raw.githubusercontent.com/marcelscruz/public-apis/main/db/resources.json'), home_url: entry.Link };
  const a = accessForRecord(rec, AT);
  assert.equal(a.auth.type, 'none');
  assert.equal(prov(a, 'auth.type').confidence, 0.6);
  assert.equal(prov(a, 'auth.type').method, 'declared');
  assert.equal(a.cost.model, 'free');
  assert.deepEqual(a.provenance.base_urls, { method: 'declared', source_url: 'https://catfact.ninja/', confidence: 0.5, checked_at: AT });

  const weird = accessForRecord({ ...raw('public-apis', { ...entry, Auth: 'weird' }), home_url: entry.Link }, AT);
  assert.equal(weird.auth.type, 'unknown');
  assert.ok(!('auth.type' in weird.provenance));
});

test('4.2-M06: accessForRecord apis.guru — info_license seeds license (method spec 0.9), cost unknown, auth unknown; COST_FREE_SOURCES', () => {
  const a = accessForRecord(raw('apis.guru', { info_license: { name: 'Apache 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0.html' } }, SPEC_URL), AT);
  assert.equal(a.license.spdx, 'Apache-2.0');
  assert.equal(prov(a, 'license.spdx').method, 'spec');
  assert.equal(prov(a, 'license.spdx').confidence, 0.9);
  assert.equal(a.auth.type, 'unknown');
  assert.equal(a.cost.model, 'unknown');
  assert.equal(accessClarity(a), 0);

  const b = accessForRecord(raw('apis.guru', { info_license: null }, SPEC_URL), AT);
  assert.equal(b.license.spdx, null);

  assert.deepEqual(COST_FREE_SOURCES, ['data.gouv.fr', 'uk-api-catalogue', 'public-apis']);

  const nope = accessForRecord(raw('nope', {}), AT);
  assert.deepEqual(nope, emptyAccess());
  assert.deepEqual(nope.provenance, {});
});
