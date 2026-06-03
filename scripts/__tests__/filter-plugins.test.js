/**
 * scripts/__tests__/filter-plugins.test.js
 *
 * Phase 3.2 Task 7. Pure in-memory plugin filter pipeline over synthetic
 * REPO-LEVEL raw records (the real plugins-raw.ndjson shape, per F-1).
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterPluginsRaw, repoToPluginEntity } from '../filter-plugins.js';

function repoRecord(overrides = {}) {
  return {
    repo_full_name: 'owner/good-plugin',
    stars: 1200,
    forks: 10,
    open_issues: 2,
    description: 'A genuinely useful plugin repo that does many helpful things for users.',
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
    plugin_manifest: { name: 'good-plugin', description: 'A genuinely useful plugin that does many helpful things daily.', version: '1.0.0', author: { name: 'owner' }, keywords: ['productivity'] },
    marketplace_manifest: null,
    components: { skills: { path: 'skills', count: 2, entries: [{ name: 'a', path: 'skills/a' }, { name: 'b', path: 'skills/b' }] } },
    component_summary: { skills: 2, agents: 0, commands: 0, hooks: 0, mcp_servers: 0, lsp_servers: 0, total: 2 },
    scraped_at: '2026-05-30T00:00:00Z',
    ...overrides,
  };
}

test('Task 7: repoToPluginEntity maps repo-level raw to a plugin EntityRecord', () => {
  const e = repoToPluginEntity(repoRecord());
  assert.equal(e.entity_type, 'plugin');
  assert.equal(e.repo_full_name, 'owner/good-plugin');
  assert.equal(e.repo_stars, 1200);
  assert.equal(e.extra.type, 'plugin');
  assert.ok(e.extra.manifest.name === 'good-plugin');
  assert.ok(Array.isArray(e.extra.bundled_skills));
});

test('Task 7: filterPluginsRaw keeps valid plugins, drops slop', () => {
  const raw = [
    repoRecord(), // valid
    repoRecord({ repo_full_name: 'owner/no-manifest', plugin_manifest: null, marketplace_manifest: null, component_summary: { skills: 1, total: 1 } }), // no manifest, no listing -> slop
    repoRecord({ repo_full_name: 'owner/empty', component_summary: { skills: 0, agents: 0, commands: 0, hooks: 0, mcp_servers: 0, total: 0 }, components: {} }), // no components -> slop
  ];
  const { records, tiers } = filterPluginsRaw(raw);
  assert.equal(records.length, 1);
  assert.equal(records[0].entity_type, 'plugin');
  assert.ok(records[0].tags.length >= 1, 'records carry tags');
  assert.ok('featured' in tiers && 'solid' in tiers && 'listed' in tiers);
});

test('Task 7: PRESERVED_FIELDS round-trip keeps is_duplicate and bundled_in_plugins', () => {
  const raw = [repoRecord()];
  const prior = new Map([[
    'plugin:owner/good-plugin/.claude-plugin/plugin.json',
    { is_duplicate: true, bundled_in_plugins: ['plugin:x/y/p'] },
  ]]);
  const { records } = filterPluginsRaw(raw, prior);
  assert.equal(records.length, 1);
  assert.equal(records[0].is_duplicate, true);
  assert.deepEqual(records[0].bundled_in_plugins, ['plugin:x/y/p']);
});

test('Task 7: readme/body trim does not exceed 1500 chars in extra.readme_markdown', () => {
  const raw = [repoRecord({ plugin_manifest: { name: 'good-plugin', description: 'A genuinely useful plugin that does many helpful things daily.', version: '1', author: { name: 'o' }, keywords: ['k'] } })];
  const { records } = filterPluginsRaw(raw, new Map(), { readme: 'z'.repeat(5000) });
  // readme injected via opts for the test; default path leaves it ''.
  assert.ok((records[0].extra.readme_markdown || '').length <= 1503);
});
