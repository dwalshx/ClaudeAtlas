/**
 * src/lib/__tests__/types.test.js
 *
 * Phase 3.2 Task 1. Runtime shape guards for the expanded PluginExtra +
 * McpExtra typedefs and the new EntityCommon.bundled_in_plugins field.
 *
 * The typedefs are TS interfaces (compile-time only); these tests assert
 * that a synthetic record built to the documented shape round-trips through
 * JSON.parse(JSON.stringify(...)) and retains structure. They lock the
 * field list so a future edit that drops a Phase 3.2 field gets caught.
 *
 * `node --test` only — no external framework.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

function syntheticPlugin() {
  return {
    id: 'plugin:owner/repo/.claude-plugin/plugin.json',
    slug: 'owner/repo',
    entity_type: 'plugin',
    name: 'repo',
    description: 'A plugin that does useful things for Claude Code users daily.',
    repo_full_name: 'owner/repo',
    repo_url: 'https://github.com/owner/repo',
    repo_stars: 100,
    repo_forks: 5,
    repo_open_issues: 2,
    repo_topics: [],
    repo_license: 'MIT',
    repo_language: 'TypeScript',
    repo_created_at: '2026-01-01T00:00:00Z',
    repo_updated_at: '2026-05-01T00:00:00Z',
    repo_pushed_at: '2026-05-01T00:00:00Z',
    repo_owner_type: 'User',
    repo_owner_avatar: '',
    repo_archived: false,
    repo_is_fork: false,
    repo_description: 'A repo',
    body_length: 1200,
    quality_score: 80,
    quality_tier: 'featured',
    novelty_score: 0,
    is_duplicate: false,
    canonical_id: null,
    tags: ['category:productivity-and-other'],
    category: 'Productivity & Other',
    scraped_at: '2026-05-30T00:00:00Z',
    content_sha: 'abc',
    source: 'discover',
    discovery_signals: ['plugin'],
    schema_version: 2,
    bundled_in_plugins: [],
    extra: {
      type: 'plugin',
      plugin_path: '.claude-plugin/plugin.json',
      manifest: { name: 'repo', version: '1.0.0', author: 'owner', keywords: ['x'] },
      readme_markdown: 'A readme',
      commands: ['cmd-a'],
      hooks: ['hook-a'],
      marketplace_listings: ['someowner/marketplace'],
      bundled_skills: ['skill:owner/repo/skills/foo/SKILL.md'],
      bundled_agents: ['agent-x'],
      bundled_commands: ['cmd-a'],
      bundled_hooks: ['hook-a'],
      bundled_mcp_servers: [],
      manifest_completeness: 1.0,
    },
  };
}

function syntheticMcp() {
  return {
    id: 'mcp_server:owner/repo/server',
    slug: 'owner/repo-mcp',
    entity_type: 'mcp_server',
    name: 'repo-mcp',
    description: 'An MCP server that exposes useful tools over stdio transport.',
    repo_full_name: 'owner/repo',
    repo_url: 'https://github.com/owner/repo',
    repo_stars: 50,
    repo_forks: 1,
    repo_open_issues: 0,
    repo_topics: [],
    repo_license: 'Apache-2.0',
    repo_language: 'Python',
    repo_created_at: '2026-01-01T00:00:00Z',
    repo_updated_at: '2026-05-01T00:00:00Z',
    repo_pushed_at: '2026-05-01T00:00:00Z',
    repo_owner_type: 'User',
    repo_owner_avatar: '',
    repo_archived: false,
    repo_is_fork: false,
    repo_description: 'A repo',
    body_length: 800,
    quality_score: 70,
    quality_tier: 'solid',
    novelty_score: 0,
    is_duplicate: false,
    canonical_id: null,
    tags: ['category:ai-and-automation'],
    category: 'AI & Automation',
    scraped_at: '2026-05-30T00:00:00Z',
    content_sha: 'def',
    source: 'discover',
    discovery_signals: ['mcp'],
    schema_version: 2,
    bundled_in_plugins: [],
    extra: {
      type: 'mcp_server',
      server_path: 'server',
      manifest: {},
      readme_markdown: 'readme',
      tools: ['tool-a', 'tool-b'],
      transport: 'stdio',
      manifest_completeness: 0.8,
    },
  };
}

test('Task 1: synthetic plugin record round-trips and retains all Phase 3.2 fields', () => {
  const rec = JSON.parse(JSON.stringify(syntheticPlugin()));
  assert.equal(rec.entity_type, 'plugin');
  assert.ok(Array.isArray(rec.bundled_in_plugins), 'EntityCommon.bundled_in_plugins is array');
  assert.ok(Array.isArray(rec.extra.marketplace_listings), 'extra.marketplace_listings is array');
  assert.ok(Array.isArray(rec.extra.bundled_skills), 'extra.bundled_skills is array');
  assert.ok(Array.isArray(rec.extra.bundled_agents), 'extra.bundled_agents is array');
  assert.ok(Array.isArray(rec.extra.bundled_commands), 'extra.bundled_commands is array');
  assert.ok(Array.isArray(rec.extra.bundled_hooks), 'extra.bundled_hooks is array');
  assert.ok(Array.isArray(rec.extra.bundled_mcp_servers), 'extra.bundled_mcp_servers is array');
  assert.equal(typeof rec.extra.manifest_completeness, 'number');
});

test('Task 1: synthetic mcp record round-trips and retains manifest_completeness', () => {
  const rec = JSON.parse(JSON.stringify(syntheticMcp()));
  assert.equal(rec.entity_type, 'mcp_server');
  assert.ok(Array.isArray(rec.bundled_in_plugins), 'EntityCommon.bundled_in_plugins is array');
  assert.equal(typeof rec.extra.manifest_completeness, 'number');
  assert.ok(['stdio', 'sse', 'streamable-http', null].includes(rec.extra.transport));
  assert.ok(Array.isArray(rec.extra.tools));
});

test('Task 1: types.d.ts documents the Phase 3.2 PluginExtra fields', () => {
  const dts = readFileSync(join(REPO_ROOT, 'src', 'lib', 'types.d.ts'), 'utf-8');
  for (const field of [
    'marketplace_listings',
    'bundled_skills',
    'bundled_agents',
    'bundled_commands',
    'bundled_hooks',
    'bundled_mcp_servers',
    'manifest_completeness',
    'bundled_in_plugins',
  ]) {
    assert.ok(dts.includes(field), `types.d.ts must document ${field}`);
  }
});

test('Task 1: types.js JSDoc mirror documents the same Phase 3.2 fields', () => {
  const js = readFileSync(join(REPO_ROOT, 'src', 'lib', 'types.js'), 'utf-8');
  for (const field of [
    'marketplace_listings',
    'bundled_skills',
    'bundled_mcp_servers',
    'manifest_completeness',
    'bundled_in_plugins',
  ]) {
    assert.ok(js.includes(field), `types.js must document ${field}`);
  }
});

// ---------------------------------------------------------------------------
// Phase 4.1 (v4.0 Data Feeds) — envelope generalization guards.
//
// `api` and `dataset` are the first entity types that mostly do NOT live in a
// GitHub repo (D-02): `origin` lands on every record, `repo_*` become
// nullable, and the two new union members carry a TOP-LEVEL `access` block
// (D-03 — never on EntityCommon, never under `extra`). The synthetic records
// below mirror docs/PHASE-4.0-SPEC.md § "Entity model" plus the Phase 4.1
// additions (`source_modified_at`, `access_clarity`).
// ---------------------------------------------------------------------------

function emptyConsumedBy() {
  return { skills: [], plugins: [], mcp_servers: [] };
}

function nullRepoFields() {
  // All sixteen repo_* fields, null — an api/dataset record with no known repo.
  return {
    repo_full_name: null,
    repo_url: null,
    repo_stars: null,
    repo_forks: null,
    repo_open_issues: null,
    repo_topics: null,
    repo_license: null,
    repo_language: null,
    repo_created_at: null,
    repo_updated_at: null,
    repo_pushed_at: null,
    repo_owner_type: null,
    repo_owner_avatar: null,
    repo_archived: null,
    repo_is_fork: null,
    repo_description: null,
  };
}

function syntheticApi() {
  return {
    id: 'api:api.stripe.com/stripe',
    slug: 'stripe.com/stripe',
    entity_type: 'api',
    name: 'stripe',
    description:
      'The Stripe REST API: payments, subscriptions, invoicing and payouts over HTTPS with bearer auth.',
    origin: {
      kind: 'registry',
      source: 'apis.guru',
      source_id: 'stripe.com',
      source_url: 'https://api.apis.guru/v2/specs/stripe.com/2022-11-15/openapi.json',
      also_listed_in: [],
    },
    home_url: 'https://stripe.com',
    docs_url: 'https://stripe.com/docs/api',
    ...nullRepoFields(),
    body_length: 120,
    quality_score: 0,
    quality_tier: 'listed',
    novelty_score: 0,
    is_duplicate: false,
    canonical_id: null,
    tags: ['category:api-and-backend'],
    category: 'API & Backend',
    scraped_at: '2026-11-02T00:00:00Z',
    content_sha: 'a1b2c3',
    source: 'registry',
    discovery_signals: [],
    schema_version: 2,
    bundled_in_plugins: [],
    access: {
      cost: { model: 'freemium', free_tier: null, price_notes: null },
      rate_limit: { requests: null, per: null, notes: null, headers_observed: [] },
      auth: { type: 'bearer', signup_url: null },
      license: { spdx: null, name: null, url: null },
      formats: ['json'],
      transport: 'rest',
      provenance: {
        'auth.type': {
          method: 'spec',
          source_url: 'https://x',
          confidence: 0.95,
          checked_at: '2026-11-02T00:00:00Z',
        },
      },
    },
    extra: {
      type: 'api',
      base_urls: ['https://api.stripe.com/'],
      spec_url: 'https://x',
      spec_version: '3.0.0',
      endpoint_count: null,
      categories_src: ['financial'],
      provider: 'stripe.com',
      status_page_url: null,
      sdks: [],
      source_modified_at: '2023-03-06T07:12:59.965Z',
      access_clarity: 0,
      consumed_by: emptyConsumedBy(),
    },
  };
}

function syntheticDataset() {
  return {
    id: 'dataset:zenodo/23888170',
    slug: 'zenodo/archi-v2',
    entity_type: 'dataset',
    name: 'archi-v2',
    description:
      'ARCHI v2: an annotated corpus of architectural floor plans with room-level labels, released on Zenodo.',
    origin: {
      kind: 'registry',
      source: 'zenodo',
      source_id: '23888170',
      source_url: 'https://zenodo.org/api/records/23888170',
      also_listed_in: [],
    },
    home_url: 'https://zenodo.org/records/23888170',
    docs_url: null,
    ...nullRepoFields(),
    body_length: 340,
    quality_score: 0,
    quality_tier: 'listed',
    novelty_score: 0,
    is_duplicate: false,
    canonical_id: null,
    tags: ['category:data-and-analytics'],
    category: 'Data & Analytics',
    scraped_at: '2026-11-02T00:00:00Z',
    content_sha: 'd4e5f6',
    source: 'registry',
    discovery_signals: [],
    schema_version: 2,
    bundled_in_plugins: [],
    access: {
      cost: { model: 'free', free_tier: null, price_notes: null },
      rate_limit: { requests: null, per: null, notes: null, headers_observed: [] },
      auth: { type: 'none', signup_url: null },
      license: { spdx: 'CC-BY-4.0', name: 'Creative Commons Attribution 4.0', url: null },
      formats: ['zip'],
      transport: 'download',
      provenance: {
        'license.spdx': {
          method: 'declared',
          source_url: 'https://zenodo.org/api/records/23888170',
          confidence: 1,
          checked_at: '2026-11-02T00:00:00Z',
        },
      },
    },
    extra: {
      type: 'dataset',
      download_urls: ['https://zenodo.org/records/23888170/files/archi-v2.zip?download=1'],
      size_bytes: 4544128,
      size_bucket: null,
      record_count: null,
      update_frequency: null,
      temporal_coverage: null,
      publisher: 'zenodo',
      popularity: { downloads: 312, views: 1480, likes: null, citations: 4, window: 'all_time' },
      schema_url: null,
      source_modified_at: '2026-10-20T08:00:00.000Z',
      access_clarity: 0,
      consumed_by: emptyConsumedBy(),
    },
  };
}

test('4.1-M01: synthetic api record round-trips JSON with top-level access and null repo_*', () => {
  const rec = JSON.parse(JSON.stringify(syntheticApi()));
  assert.equal(rec.entity_type, 'api');
  assert.equal(typeof rec.access, 'object', 'access block is top-level on api records');
  assert.equal(rec.access.cost.model, 'freemium');
  assert.equal(rec.repo_full_name, null, 'repo_full_name is null when no repo is known');
  assert.equal(rec.repo_stars, null, 'repo_stars is null when no repo is known');
  assert.equal(rec.origin.kind, 'registry');
  assert.equal(typeof rec.extra.access_clarity, 'number');
  assert.deepEqual(Object.keys(rec.extra.consumed_by).sort(), ['mcp_servers', 'plugins', 'skills']);
});

test('4.1-M01: synthetic dataset record round-trips JSON and retains popularity + source_modified_at', () => {
  const rec = JSON.parse(JSON.stringify(syntheticDataset()));
  assert.equal(rec.entity_type, 'dataset');
  assert.equal(rec.extra.popularity.citations, 4);
  assert.equal(typeof rec.extra.source_modified_at, 'string');
  assert.equal(rec.repo_pushed_at, null, 'repo_pushed_at is null when no repo is known');
});

test('4.1-M01: types.d.ts documents the Phase 4.1 envelope', () => {
  const dts = readFileSync(join(REPO_ROOT, 'src', 'lib', 'types.d.ts'), 'utf-8');
  for (const s of [
    "| 'api'",
    "| 'dataset'",
    'interface Origin',
    'interface AccessBlock',
    'interface AccessProvenance',
    'interface ConsumedBy',
    'interface ApiExtra',
    'interface DatasetExtra',
    'origin: Origin',
    'home_url: string',
    'docs_url: string | null',
    'repo_full_name: string | null',
    'repo_stars: number | null',
    'source_modified_at: string | null',
    'access_clarity: number',
    'consumed_by: ConsumedBy',
    "entity_type: 'api'; access: AccessBlock; extra: ApiExtra",
    "entity_type: 'dataset'; access: AccessBlock; extra: DatasetExtra",
  ]) {
    assert.ok(dts.includes(s), s);
  }
});

test('4.1-M01: types.js JSDoc mirror documents the same Phase 4.1 names', () => {
  const js = readFileSync(join(REPO_ROOT, 'src', 'lib', 'types.js'), 'utf-8');
  for (const s of [
    "'api' | 'dataset'",
    '@typedef {Object} Origin',
    '@typedef {Object} AccessBlock',
    '@typedef {Object} ApiExtra',
    '@typedef {Object} DatasetExtra',
    'origin',
    'home_url',
    'docs_url',
    'consumed_by',
    'provenance',
    'source_modified_at',
    'access_clarity',
  ]) {
    assert.ok(js.includes(s), s);
  }
});

test('4.1-M01/D-03: access is NOT declared on EntityCommon', () => {
  const dts = readFileSync(join(REPO_ROOT, 'src', 'lib', 'types.d.ts'), 'utf-8');
  const start = dts.indexOf('export interface EntityCommon {');
  assert.ok(start >= 0, 'EntityCommon interface present');
  const end = dts.indexOf('\n}', start);
  const slice = dts.slice(start, end);
  assert.ok(!slice.includes('access:'), 'access block must live on the api/dataset union members only');
});
