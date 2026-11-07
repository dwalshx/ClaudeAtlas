/**
 * scripts/lib/feeds/__tests__/openapi-extract.test.js
 *
 * Phase 4.2 Plan 02 (4.2-M01 / 4.2-M02, D-10). RED until Plan 07 / Plan 06 land.
 *
 * Contract tests for extractOpenApi: OAS 3.x (stripe trim) and Swagger 2
 * (data.gov) captured 2026-11-05, plus synthetic edge cases. Media types are
 * returned RAW (api-access.js does the whitelisting).
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractOpenApi, METHODS } from '../openapi-extract.js';

const ROOT = join(import.meta.dirname, '..', '..', '..', '..');
const FIX = join(ROOT, 'data', '__fixtures__', 'feeds');
const load = (name) => JSON.parse(readFileSync(join(FIX, name), 'utf-8'));

test('4.2-M02: stripe OAS3 → servers, two http schemes, top-level security, 2 endpoints, json media', () => {
  const ex = extractOpenApi(load('openapi3-stripe-trimmed.json'));
  assert.equal(ex.spec_version, '3.0.0');
  assert.deepEqual(ex.base_urls, ['https://api.stripe.com/']);
  assert.equal(ex.endpoint_count, 2);
  assert.deepEqual(Object.keys(ex.security.schemes).sort(), ['basicAuth', 'bearerAuth']);
  assert.deepEqual(ex.security.requirements, [{ basicAuth: [] }, { bearerAuth: [] }]);
  assert.deepEqual(ex.media_types, ['application/json']);
  assert.equal(ex.license, null);
  assert.equal(ex.terms, 'https://stripe.com/us/terms/');
  assert.equal(ex.external_docs_url, null);
  assert.equal(ex.transport, 'rest');
  assert.deepEqual(ex.endpoint_summaries, ['GET /v1/account GetAccount', 'POST /v1/account_links PostAccountLinks']);
  assert.equal(ex.info_title, 'Stripe API');
});

test('4.2-M02: data.gov Swagger 2 → host+basePath, apiKey definition, op-level produces incl. typo and */*', () => {
  const ex = extractOpenApi(load('swagger2-datagov.json'));
  assert.equal(ex.spec_version, '2.0');
  assert.deepEqual(ex.base_urls, ['https://api.data.gov/regulations/v3']);
  assert.equal(ex.endpoint_count, 3);
  assert.deepEqual(Object.keys(ex.security.schemes), ['api_key']);
  assert.equal(ex.security.schemes.api_key.type, 'apiKey');
  assert.deepEqual(ex.security.requirements, [{ api_key: [] }]);
  assert.deepEqual(ex.media_types, ['application/json', 'applicaiton/xml', '*/*']);
  assert.equal(typeof ex.external_docs_url, 'string');
  assert.equal(ex.transport, 'rest');
});

test('4.2-M02: OAS3 server variables are substituted with defaults; empty results dropped', () => {
  const ex = extractOpenApi({
    openapi: '3.1.0',
    servers: [
      { url: 'https://{region}.api.example.com/{v}', variables: { region: { default: 'eu' }, v: { default: 'v2' } } },
      { url: '' },
    ],
    paths: {},
  });
  assert.deepEqual(ex.base_urls, ['https://eu.api.example.com/v2']);
  assert.equal(ex.endpoint_count, 0);
  assert.deepEqual(ex.endpoint_summaries, []);
});

test('4.2-M02: Swagger 2 without host → base_urls []; schemes default https', () => {
  assert.deepEqual(extractOpenApi({ swagger: '2.0', basePath: '/v1', paths: {} }).base_urls, []);
  assert.deepEqual(extractOpenApi({ swagger: '2.0', host: 'h.example', paths: {} }).base_urls, ['https://h.example']);
  assert.deepEqual(extractOpenApi({ swagger: '2.0', schemes: ['http'], host: 'h', basePath: '/b', paths: {} }).base_urls, ['http://h/b']);
});

test('4.2-M02: endpoint_count counts only HTTP methods and summaries cap at 10 × 80 chars', () => {
  const paths = {};
  for (let i = 0; i < 12; i++) {
    paths[`/p${i}`] = { get: { summary: 'S'.repeat(200) }, parameters: [], 'x-ext': { a: 1 } };
  }
  const ex = extractOpenApi({ openapi: '3.0.0', paths });
  assert.equal(ex.endpoint_count, 12);
  assert.equal(ex.endpoint_summaries.length, 10);
  for (const s of ex.endpoint_summaries) {
    assert.ok(s.length <= 80, `summary too long: ${s.length}`);
    assert.ok(s.startsWith('GET /'), s);
  }
  assert.ok(METHODS.has('get') && !METHODS.has('parameters'));
});

test('4.2-M02: media types are collected from responses content, op.produces and spec.produces in first-seen order', () => {
  const ex = extractOpenApi({
    openapi: '3.0.0',
    produces: ['text/plain'],
    paths: {
      '/x': {
        get: {
          produces: ['application/xml'],
          responses: { 200: { content: { 'text/csv': {}, 'application/json': {} } } },
        },
      },
    },
  });
  assert.deepEqual(ex.media_types, ['text/csv', 'application/json', 'application/xml', 'text/plain']);
});

test('4.2-M02: /graphql path flips transport to graphql; summary falls back to operationId then empty', () => {
  const ex = extractOpenApi({
    openapi: '3.0.0',
    paths: { '/graphql': { post: { operationId: 'gql' } }, '/x': { get: {} } },
  });
  assert.equal(ex.transport, 'graphql');
  assert.deepEqual(ex.endpoint_summaries, ['POST /graphql gql', 'GET /x']);
});

test('4.2-M02: non-object input returns null and never throws', () => {
  assert.equal(extractOpenApi(null), null);
  assert.equal(extractOpenApi('x'), null);
  assert.equal(extractOpenApi(42), null);
  assert.doesNotThrow(() => extractOpenApi({}));
  const ex = extractOpenApi({});
  assert.equal(ex.spec_version, null);
  assert.deepEqual(ex.base_urls, []);
  assert.equal(ex.endpoint_count, 0);
  assert.equal(ex.license, null);
});
