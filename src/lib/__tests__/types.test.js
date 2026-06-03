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
