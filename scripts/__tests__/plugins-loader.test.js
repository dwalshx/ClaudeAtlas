/**
 * scripts/__tests__/plugins-loader.test.js
 *
 * Phase 3.3 Plan 02 (D-04, D-05, D-08, D-09, D-10). Unit tests for the NEW
 * src/lib/plugins.js loader — the build-time data source for plugin + MCP
 * pages. RESEARCH Pitfall 1: entities.js getEntitiesByType('plugin') returns
 * [] at build time (it only reads data/skills.ndjson), so the page layer
 * needs this dedicated loader reading data/plugins.ndjson +
 * data/mcp-servers.ndjson via streaming NDJSON.
 *
 * Lives under scripts/__tests__/ because the npm-test glob is
 * scripts/**\/*.test.js (VALIDATION.md test-location note) — a test next to
 * src/lib/plugins.js would never run.
 *
 * Assertions are resilient to sample-data drift: contract/shape checks
 * (length >= 1, slug round-trips, missing IDs filtered) anchored against
 * IDs read from the on-disk sample, never specific record contents.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readNdjsonRecords } from '../lib/ndjson.js';
import {
  getPlugins,
  getMcpServers,
  getPluginBySlug,
  getMcpBySlug,
  resolveBundledSkills,
  resolveBundledMcps,
  resolveBundledPlugins,
  installCommand,
} from '../../src/lib/plugins.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../data');
const PLUGINS_PATH = join(DATA, 'plugins.ndjson');
const MCPS_PATH = join(DATA, 'mcp-servers.ndjson');

// ---------------------------------------------------------------------------
// getPlugins / getMcpServers — streaming NDJSON load, graceful when absent
// ---------------------------------------------------------------------------

test('getPlugins() returns a non-empty array when data/plugins.ndjson exists; [] when absent', () => {
  const plugins = getPlugins();
  assert.ok(Array.isArray(plugins), 'getPlugins returns an array');
  if (existsSync(PLUGINS_PATH)) {
    assert.ok(plugins.length >= 1, 'non-empty when the data file is on disk');
    // Every record is a plugin EntityRecord with an id + slug.
    assert.equal(plugins[0].entity_type, 'plugin');
    assert.ok(typeof plugins[0].id === 'string' && plugins[0].id.length > 0);
    assert.ok(typeof plugins[0].slug === 'string' && plugins[0].slug.length > 0);
    // The _header sentinel line must NOT leak into records.
    assert.ok(plugins.every((p) => p._header !== true), 'no header records');
  } else {
    assert.equal(plugins.length, 0, 'graceful empty when file absent');
  }
});

test('getMcpServers() returns records from data/mcp-servers.ndjson', () => {
  const mcps = getMcpServers();
  assert.ok(Array.isArray(mcps), 'getMcpServers returns an array');
  if (existsSync(MCPS_PATH)) {
    assert.ok(mcps.length >= 1, 'non-empty when the data file is on disk');
    assert.equal(mcps[0].entity_type, 'mcp_server');
    assert.ok(mcps.every((m) => m._header !== true), 'no header records');
  } else {
    assert.equal(mcps.length, 0, 'graceful empty when file absent');
  }
});

// ---------------------------------------------------------------------------
// Slug lookups — direct-URL access must resolve (no is_duplicate filter)
// ---------------------------------------------------------------------------

test('getPluginBySlug(knownSlug) round-trips; unknown slug returns null', (t) => {
  const plugins = getPlugins();
  if (plugins.length === 0) return t.skip('no plugin sample data on disk');

  const known = plugins[0];
  const found = getPluginBySlug(known.slug);
  assert.ok(found, 'known slug resolves');
  assert.equal(found.id, known.id, 'slug lookup returns the same record');

  assert.equal(getPluginBySlug('definitely/not-a-real-slug-xyz'), null);
  assert.equal(getPluginBySlug(''), null);

  // Direct lookup must NOT filter duplicates (matches getSkillBySlug):
  // every record in the loader output is resolvable by its own slug.
  const dup = plugins.find((p) => p.is_duplicate === true);
  if (dup) {
    assert.ok(getPluginBySlug(dup.slug), 'duplicate records resolve by direct slug lookup');
  }
});

test('getMcpBySlug(knownSlug) round-trips; unknown slug returns null', (t) => {
  const mcps = getMcpServers();
  if (mcps.length === 0) return t.skip('no MCP sample data on disk');

  const known = mcps[0];
  const found = getMcpBySlug(known.slug);
  assert.ok(found, 'known slug resolves');
  assert.equal(found.id, known.id);

  assert.equal(getMcpBySlug('definitely/not-a-real-slug-xyz'), null);
});

// ---------------------------------------------------------------------------
// Bundle-graph resolution — IDs (not slugs) → records, missing IDs filtered,
// order preserved. RESEARCH Pitfall 3 / Q4.
// ---------------------------------------------------------------------------

test('resolveBundledSkills resolves real bundled_skills IDs, filters missing, preserves order', (t) => {
  if (!existsSync(PLUGINS_PATH)) return t.skip('no plugin sample data on disk');

  // Anchor against a real forward edge from the on-disk sample: find a
  // plugin that actually bundles skills (verified present in the sample).
  const raw = [...readNdjsonRecords(PLUGINS_PATH, { keyFn: (r) => r.id }).values()];
  const bundler = raw.find((p) => (p.extra?.bundled_skills || []).length >= 1);
  if (!bundler) return t.skip('sample has no plugin with bundled_skills');

  const ids = bundler.extra.bundled_skills;
  const resolved = resolveBundledSkills(ids);
  assert.ok(resolved.length >= 1, 'at least one bundled skill resolves to a record');
  assert.ok(
    resolved.every((s) => s && s.entity_type === 'skill'),
    'resolved records are skills',
  );
  // Order preserved: resolved IDs appear in the same relative order as input.
  const resolvedIds = resolved.map((s) => s.id);
  const inputOrder = ids.filter((id) => resolvedIds.includes(id) || resolvedIds.includes(id.replace(/^skill:/, '')));
  assert.deepEqual(
    resolvedIds,
    inputOrder.map((id) => id.replace(/^skill:/, '')),
    'output order follows input order',
  );

  // Missing IDs are filtered (filter(Boolean)), present ones survive.
  const firstResolvedId = resolvedIds[0];
  const mixed = resolveBundledSkills([
    firstResolvedId,
    'skill:missing/x/SKILL.md',
    'missing/y/SKILL.md',
  ]);
  assert.equal(mixed.length, 1, 'missing IDs filtered out');
  assert.equal(mixed[0].id, firstResolvedId);

  // Tolerant of the typedef's `skill:` prefix even though on-disk skill IDs
  // are legacy-unprefixed (data-verified): prefixed form still resolves.
  const prefixed = resolveBundledSkills([`skill:${firstResolvedId}`]);
  assert.equal(prefixed.length, 1, 'skill:-prefixed ID resolves via normalization');
  assert.equal(prefixed[0].id, firstResolvedId);

  // Null/undefined input → [].
  assert.deepEqual(resolveBundledSkills(null), []);
  assert.deepEqual(resolveBundledSkills(undefined), []);
});

test('resolveBundledPlugins resolves reverse-edge plugin IDs (skill.bundled_in_plugins)', (t) => {
  const plugins = getPlugins();
  if (plugins.length === 0) return t.skip('no plugin sample data on disk');

  // Reverse-edge IDs carry the `plugin:` prefix (data-verified) and ARE the
  // plugin record IDs — direct index hit.
  const known = plugins[0];
  const resolved = resolveBundledPlugins([
    known.id,
    'plugin:missing/repo/.claude-plugin/plugin.json',
  ]);
  assert.equal(resolved.length, 1, 'missing plugin IDs filtered');
  assert.equal(resolved[0].id, known.id);
  assert.deepEqual(resolveBundledPlugins([]), []);
  assert.deepEqual(resolveBundledPlugins(null), []);
});

test('resolveBundledMcps resolves bundled_mcp_servers IDs to MCP records', (t) => {
  const mcps = getMcpServers();
  if (mcps.length === 0) return t.skip('no MCP sample data on disk');

  const known = mcps[0];
  const resolved = resolveBundledMcps([known.id, 'mcp_server:missing/repo/path']);
  assert.equal(resolved.length, 1, 'missing MCP IDs filtered');
  assert.equal(resolved[0].id, known.id);
  assert.deepEqual(resolveBundledMcps(null), []);
});

// ---------------------------------------------------------------------------
// installCommand — two-step marketplace install derivation (D-08).
// RESEARCH Q1 / Pitfall 2: step-2 token is `<plugin-name>@<declared-name>`;
// declared-name missing → NO broken install token, GitHub fallback only.
// ---------------------------------------------------------------------------

function makePlugin(listings) {
  return {
    id: 'plugin:owner/repo/.claude-plugin/plugin.json',
    slug: 'owner/repo',
    entity_type: 'plugin',
    name: 'my-plugin',
    repo_url: 'https://github.com/owner/repo',
    extra: { type: 'plugin', marketplace_listings: listings },
  };
}

test('installCommand: {path,name} listing yields both steps + GitHub fallback', () => {
  const cmd = installCommand(makePlugin([{ path: 'a/b', name: 'mkt' }]));
  assert.equal(cmd.hasMarketplace, true);
  assert.equal(cmd.addCmd, '/plugin marketplace add a/b');
  assert.equal(cmd.installCmd, '/plugin install my-plugin@mkt');
  assert.equal(cmd.githubFallback, true);
});

test('installCommand: empty listings → no marketplace, no broken install token', () => {
  const cmd = installCommand(makePlugin([]));
  assert.equal(cmd.hasMarketplace, false);
  assert.equal(cmd.addCmd, null);
  assert.equal(cmd.installCmd, null);
  assert.equal(cmd.githubFallback, true);
});

test('installCommand: {path, name:null} → step 1 only, installCmd null (GitHub fallback for step 2)', () => {
  const cmd = installCommand(makePlugin([{ path: 'a/b', name: null }]));
  assert.equal(cmd.hasMarketplace, true);
  assert.equal(cmd.addCmd, '/plugin marketplace add a/b');
  assert.equal(cmd.installCmd, null, 'no declared name → never emit name@owner/repo');
  assert.equal(cmd.githubFallback, true);
});

test('installCommand: legacy bare-string listing normalized to {path, name:null}', () => {
  // Pre-Plan-01 records carry bare path strings (data-verified on the
  // 2026-05-31 sample). Must normalize, not crash or emit a broken token.
  const cmd = installCommand(makePlugin(['a/b']));
  assert.equal(cmd.hasMarketplace, true);
  assert.equal(cmd.addCmd, '/plugin marketplace add a/b');
  assert.equal(cmd.installCmd, null);
  assert.equal(cmd.githubFallback, true);
});

test('installCommand: missing/undefined marketplace_listings handled gracefully', () => {
  const plugin = makePlugin([]);
  delete plugin.extra.marketplace_listings;
  const cmd = installCommand(plugin);
  assert.equal(cmd.hasMarketplace, false);
  assert.equal(cmd.installCmd, null);
  assert.equal(cmd.githubFallback, true);
});

test('installCommand: first listing wins when multiple are present', () => {
  const cmd = installCommand(
    makePlugin([
      { path: 'first/mkt', name: 'one' },
      { path: 'second/mkt', name: 'two' },
    ]),
  );
  assert.equal(cmd.addCmd, '/plugin marketplace add first/mkt');
  assert.equal(cmd.installCmd, '/plugin install my-plugin@one');
});
