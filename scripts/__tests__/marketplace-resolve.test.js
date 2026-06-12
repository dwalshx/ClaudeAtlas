/**
 * scripts/__tests__/marketplace-resolve.test.js
 *
 * Phase 3.3 Wave 0 (D-08/Q1 Option A). The install command's step 2
 * (`/plugin install name@<marketplace>`) needs the marketplace's DECLARED
 * name (marketplace_manifest.name), not the owner/repo path. The pre-3.3
 * marketplaceListings() returned only [repo_full_name] and dropped the
 * declared name — the documented #1 install failure ("plugin not found in
 * any marketplace").
 *
 * marketplace_listings element shape (3.3+): { path: string, name: string|null }
 *   - path  → step 1: `/plugin marketplace add <path>`
 *   - name  → step 2: `/plugin install <plugin>@<name>` (null → GitHub fallback)
 * Pre-3.3 records stored bare path strings; loaders normalize both shapes.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMarketplaceListings, filterPluginsRaw } from '../filter-plugins.js';

function repoRecord(overrides = {}) {
  return {
    repo_full_name: 'BenWeekes/ai-dev',
    stars: 800,
    forks: 4,
    open_issues: 1,
    description: 'A genuinely useful marketplace repo that advertises several helpful plugins.',
    topics: [],
    language: 'TypeScript',
    license: 'MIT',
    created_at: '2026-01-01T00:00:00Z',
    pushed_at: new Date().toISOString(),
    archived: false,
    is_fork: false,
    owner_type: 'User',
    owner_avatar: '',
    default_branch: 'main',
    plugin_manifest: { name: 'ai-dev', description: 'A genuinely useful plugin doing many helpful things daily.', version: '1.0.0', author: { name: 'BenWeekes' }, keywords: ['ai'] },
    marketplace_manifest: { name: 'ai-dev-kit', plugins: [] },
    components: { skills: { path: 'skills', count: 1, entries: [{ name: 'a', path: 'skills/a' }] } },
    component_summary: { skills: 1, agents: 0, commands: 0, hooks: 0, mcp_servers: 0, total: 1 },
    scraped_at: '2026-06-12T00:00:00Z',
    ...overrides,
  };
}

test('declared name propagated: entry exposes BOTH path and declared marketplace name', () => {
  const listings = resolveMarketplaceListings(repoRecord());
  assert.equal(listings.length, 1);
  assert.equal(listings[0].path, 'BenWeekes/ai-dev', 'path drives step 1 (/plugin marketplace add)');
  assert.equal(listings[0].name, 'ai-dev-kit', 'declared name drives step 2 (@name install)');
});

test('no marketplace_manifest -> [] (GitHub-fallback / empty-listing case)', () => {
  assert.deepEqual(resolveMarketplaceListings(repoRecord({ marketplace_manifest: null })), []);
  assert.deepEqual(resolveMarketplaceListings(repoRecord({ marketplace_manifest: undefined })), []);
  assert.deepEqual(resolveMarketplaceListings(null), []);
});

test('marketplace_manifest present but name missing/blank -> path kept, name null', () => {
  const noName = resolveMarketplaceListings(repoRecord({ marketplace_manifest: { plugins: [] } }));
  assert.equal(noName.length, 1);
  assert.equal(noName[0].path, 'BenWeekes/ai-dev');
  assert.equal(noName[0].name, null);

  const blankName = resolveMarketplaceListings(repoRecord({ marketplace_manifest: { name: '   ' } }));
  assert.equal(blankName.length, 1);
  assert.equal(blankName[0].name, null);

  const nonString = resolveMarketplaceListings(repoRecord({ marketplace_manifest: { name: 42 } }));
  assert.equal(nonString.length, 1);
  assert.equal(nonString[0].name, null);
});

test('declared name trimmed of surrounding whitespace', () => {
  const listings = resolveMarketplaceListings(repoRecord({ marketplace_manifest: { name: '  ai-dev-kit  ' } }));
  assert.equal(listings[0].name, 'ai-dev-kit');
});

test('missing repo_full_name -> [] (no path means no installable listing)', () => {
  assert.deepEqual(resolveMarketplaceListings(repoRecord({ repo_full_name: '' })), []);
});

test('END-TO-END: {path,name} shape survives filterPluginsRaw (incl. the v2 upcast)', () => {
  // Regression guard: upcastPluginRecord must NOT coerce/drop the object
  // entries (the pre-3.3 arr() helper filtered to strings only).
  const { records } = filterPluginsRaw([repoRecord()]);
  assert.equal(records.length, 1);
  const listings = records[0].extra.marketplace_listings;
  assert.equal(listings.length, 1, 'listing survives transform + upcast');
  assert.equal(listings[0].path, 'BenWeekes/ai-dev');
  assert.equal(listings[0].name, 'ai-dev-kit');
});

test('END-TO-END: listing-only plugin (no plugin_manifest) still passes the slop gate', () => {
  // HAS_MANIFEST_OR_LISTING relies on marketplace_listings.length >= 1 —
  // if the upcast dropped the object entries this record would vanish.
  const raw = repoRecord({ plugin_manifest: null });
  const { records } = filterPluginsRaw([raw]);
  assert.equal(records.length, 1, 'listing-only plugin survives');
  assert.equal(records[0].extra.marketplace_listings[0].name, 'ai-dev-kit');
});
