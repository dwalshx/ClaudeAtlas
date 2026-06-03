/**
 * scripts/__tests__/filter-mcps.test.js
 *
 * Phase 3.2 Task 7. MCP filter over synthetic REPO-LEVEL raw records.
 * MCPs are NESTED components of plugin repos (F-1): a repo with
 * component_summary.mcp_servers > 0 yields one mcp_server entity per
 * components["mcp-servers"].entries item.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterMcpsRaw, repoToMcpEntities } from '../filter-mcps.js';

function mcpRepo(overrides = {}) {
  return {
    repo_full_name: 'owner/mcp-repo',
    stars: 600,
    forks: 3,
    open_issues: 1,
    description: 'An MCP server repo that exposes a useful set of tools over stdio.',
    topics: [],
    language: 'Python',
    license: 'Apache-2.0',
    created_at: '2026-01-01T00:00:00Z',
    pushed_at: new Date().toISOString(),
    owner_type: 'User',
    plugin_manifest: { name: 'mcp-repo', description: 'An MCP server that exposes a useful set of tools over stdio transport.', version: '1.0.0', author: { name: 'owner' } },
    components: {
      'mcp-servers': { path: 'mcp-servers', count: 1, entries: [{ name: 'frappe_mcp', type: 'dir', path: 'mcp-servers/frappe_mcp' }] },
    },
    component_summary: { skills: 0, agents: 0, commands: 0, hooks: 0, mcp_servers: 1, lsp_servers: 0, total: 1 },
    scraped_at: '2026-05-30T00:00:00Z',
    ...overrides,
  };
}

test('Task 7: repoToMcpEntities yields one mcp_server per mcp-servers component', () => {
  const entities = repoToMcpEntities(mcpRepo());
  assert.equal(entities.length, 1);
  assert.equal(entities[0].entity_type, 'mcp_server');
  assert.equal(entities[0].extra.server_path, 'mcp-servers/frappe_mcp');
  assert.equal(entities[0].id, undefined); // id assigned by upcaster downstream
});

test('Task 7: filterMcpsRaw keeps valid MCPs, drops transport=null / zero-tools', () => {
  const raw = [
    mcpRepo(), // valid (transport defaulted to stdio, 1 tool)
    mcpRepo({ repo_full_name: 'owner/no-mcp', component_summary: { mcp_servers: 0, total: 1 }, components: {} }),
  ];
  const { records, tiers } = filterMcpsRaw(raw);
  assert.ok(records.length >= 1);
  assert.ok(records.every((r) => r.entity_type === 'mcp_server'));
  assert.ok('featured' in tiers);
});

test('Task 7: shared tier helper applied (no carve-out) — N=38 distribution', () => {
  const raw = Array.from({ length: 38 }, (_, i) =>
    mcpRepo({ repo_full_name: `owner/mcp-${String(i).padStart(3, '0')}`, stars: 1000 - i }));
  const { tiers } = filterMcpsRaw(raw);
  assert.deepEqual(tiers, { featured: 3, solid: 11, listed: 24 });
});

test('Task 7: countMcpRepos counts repos with component_summary.mcp_servers > 0', async () => {
  const { countMcpRepos } = await import('../filter-mcps.js');
  const raw = [mcpRepo(), mcpRepo({ component_summary: { mcp_servers: 0, total: 1 } }), mcpRepo()];
  assert.equal(countMcpRepos(raw), 2);
});
