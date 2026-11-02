/**
 * scripts/lib/filter-rules/__tests__/common.rules.test.js
 *
 * Phase 4.1 Plan 02 (4.1-M09 / D-07). Null-safety of the shared common
 * gates for records WITHOUT a GitHub repo (api / dataset origins):
 *   - dedupLanguageVariants key must not collapse distinct null-repo feeds:
 *     key = `${repo_full_name ?? origin.source_id ?? id ?? ''}/${baseName}`
 *   - isFixtureRepo must be null-safe (`record?.repo_full_name ?? ''`)
 *   - hasShortDescription must treat a null description as short
 *
 * Expected state at Plan 02: tests 2 + 3 RED (current key is
 * `${rec.repo_full_name}/${baseName}` → "null/weather" collides); tests
 * 1, 4, 5 are already green and act as regression guards for the Plan 06
 * edit. After Plan 06: 5 pass / 0 fail.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dedupLanguageVariants,
  isFixtureRepo,
  FIXTURE_REPO_DENYLIST,
  hasShortDescription,
} from '../common.rules.js';

test('4.1-M09: dedupLanguageVariants still collapses skill language variants within a repo', () => {
  // INPUT ORDER MATTERS (revision 1 / B1): the implementation's base-name
  // short-circuit (`rec.name === baseName`) only protects a base record that
  // arrives AFTER a variant. Keep `foo-de` first so `foo` (lower score) wins
  // on the base-name rule rather than losing on quality_score.
  const out = dedupLanguageVariants([
    { repo_full_name: 'a/b', name: 'foo-de', quality_score: 50 },
    { repo_full_name: 'a/b', name: 'foo', quality_score: 10 },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'foo');
});

test('4.1-M09: dedupLanguageVariants does NOT merge null-repo feeds from different sources (key falls back to origin.source_id)', () => {
  const out = dedupLanguageVariants([
    { repo_full_name: null, name: 'weather', origin: { source_id: 'provider-a' }, id: 'api:a.com/weather' },
    { repo_full_name: null, name: 'weather', origin: { source_id: 'provider-b' }, id: 'api:b.com/weather' },
  ]);
  assert.equal(out.length, 2);
});

test('4.1-M09: dedupLanguageVariants falls back to id when neither repo nor origin.source_id exists', () => {
  const distinct = dedupLanguageVariants([
    { repo_full_name: null, name: 'weather', id: 'api:x/weather' },
    { repo_full_name: null, name: 'weather', id: 'api:y/weather' },
  ]);
  assert.equal(distinct.length, 2);

  const same = dedupLanguageVariants([
    { repo_full_name: null, name: 'weather', id: 'api:x/weather' },
    { repo_full_name: null, name: 'weather', id: 'api:x/weather' },
  ]);
  assert.equal(same.length, 1);
});

test('4.1-M09: isFixtureRepo is null-safe and still matches the denylist', () => {
  assert.equal(isFixtureRepo({ repo_full_name: null }), false);
  assert.equal(isFixtureRepo({}), false);
  assert.equal(isFixtureRepo({ repo_full_name: [...FIXTURE_REPO_DENYLIST][0] }), true);
});

test('4.1-M09: hasShortDescription treats null description as short', () => {
  assert.equal(hasShortDescription({ description: null }, 50), true);
});
