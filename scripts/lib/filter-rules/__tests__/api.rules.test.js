/**
 * scripts/lib/filter-rules/__tests__/api.rules.test.js
 *
 * Phase 4.1 Plan 02 (4.1-M07 / D-06). api slop gates:
 *   - entity_type guard (non-api records never rejected by this pack)
 *   - MIN_DESCRIPTION_LENGTH (50) via common hasShortDescription
 *   - HAS_HOME_URL (home_url non-empty)
 *   - HAS_BASE_URL_OR_SPEC (extra.base_urls.length >= 1 OR extra.spec_url)
 * No star gate (Phase 3.1 precedent). Common gates (fixture denylist,
 * template name, placeholder description, biz-slop) still run first via
 * the index.js isSlop dispatcher.
 *
 * Written test-first (D-07): RED with ERR_MODULE_NOT_FOUND until Plan 06
 * creates scripts/lib/filter-rules/api.rules.js.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isApiSlop } from '../api.rules.js';
import { isSlop } from '../index.js';

function baseApi(top = {}, extra = {}) {
  return {
    entity_type: 'api',
    name: 'stripe',
    description: 'Stripe API: payments, billing and Connect endpoints exposed as a versioned REST API.',
    home_url: 'https://stripe.com',
    docs_url: null,
    repo_full_name: null,
    ...top,
    extra: {
      type: 'api',
      base_urls: ['https://api.stripe.com/'],
      spec_url: null,
      provider: 'stripe.com',
      ...extra,
    },
  };
}

test('4.1-M07: valid api (home_url + base_url + long description) passes', () => {
  assert.equal(isApiSlop(baseApi()), false);
});

test('4.1-M07: missing home_url is rejected (HAS_HOME_URL)', () => {
  assert.equal(isApiSlop(baseApi({ home_url: '' })), true);
  assert.equal(isApiSlop(baseApi({ home_url: null })), true);
});

test('4.1-M07: no base_urls and no spec_url is rejected (HAS_BASE_URL_OR_SPEC)', () => {
  assert.equal(isApiSlop(baseApi({}, { base_urls: [], spec_url: null })), true);
});

test('4.1-M07: spec_url alone satisfies HAS_BASE_URL_OR_SPEC', () => {
  assert.equal(isApiSlop(baseApi({}, { base_urls: [], spec_url: 'https://x/openapi.json' })), false);
});

test('4.1-M07: short description (<50) is rejected', () => {
  assert.equal(isApiSlop(baseApi({ description: 'Daily cat facts' })), true);
});

test('4.1-M07: entity_type guard — non-api record is never rejected by the api pack', () => {
  assert.equal(isApiSlop({ entity_type: 'skill', name: 'x', description: '' }), false);
});

test('4.1-M07: isSlop dispatches entity_type=api and still runs the common gates first', () => {
  assert.equal(isSlop(baseApi()), false);
  assert.equal(isSlop(baseApi({}, { base_urls: [] })), true);
  // TEMPLATE_NAMES (common gate)
  assert.equal(isSlop(baseApi({ name: 'example' })), true);
  // PLACEHOLDER_DESC_PATTERNS /^\[.*\]/ (common gate) — long enough to pass the 50-char gate on its own
  assert.equal(isSlop(baseApi({ description: '[describe your api here in detail, at least fifty chars]' })), true);
});

test('4.1-M07: null repo_full_name never throws through the common gates', () => {
  assert.doesNotThrow(() => isSlop(baseApi({ repo_full_name: null })));
});
