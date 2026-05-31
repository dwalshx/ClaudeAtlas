/**
 * scripts/lib/__tests__/bundled-links.test.js
 *
 * Phase 3.2 Task 8. Bidirectional bundle-graph populator (D-02).
 * Pure + idempotent; data-only (no rendering). `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linkBundles } from '../bundled-links.js';

function plugin(overrides = {}) {
  return {
    id: 'plugin:owner/repo/.claude-plugin/plugin.json',
    entity_type: 'plugin',
    repo_full_name: 'owner/repo',
    extra: {
      type: 'plugin',
      plugin_path: '.claude-plugin/plugin.json',
      manifest: {},
      commands: [],
      hooks: [],
      bundled_skills: [],
      bundled_agents: [],
      bundled_commands: [],
      bundled_hooks: [],
      bundled_mcp_servers: [],
      ...((overrides.extra) || {}),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'extra')),
  };
}

function skill(id, repo, path) {
  return {
    id,
    entity_type: 'skill',
    repo_full_name: repo,
    bundled_in_plugins: [],
    extra: { type: 'skill', skill_path: path },
  };
}

test('Task 8: repo-root plugin bundles colocated skill (bidirectional)', () => {
  const p = plugin();
  const s = skill('skill:owner/repo/skills/foo/SKILL.md', 'owner/repo', 'skills/foo/SKILL.md');
  const { plugins, skills } = linkBundles([p], [s]);
  assert.deepEqual(plugins[0].extra.bundled_skills, ['skill:owner/repo/skills/foo/SKILL.md']);
  assert.deepEqual(skills[0].bundled_in_plugins, ['plugin:owner/repo/.claude-plugin/plugin.json']);
});

test('Task 8: plugin in repo A and skill in repo B → no linkage', () => {
  const p = plugin({ repo_full_name: 'owner/repoA', id: 'plugin:owner/repoA/.claude-plugin/plugin.json' });
  const s = skill('skill:owner/repoB/skills/foo/SKILL.md', 'owner/repoB', 'skills/foo/SKILL.md');
  const { plugins, skills } = linkBundles([p], [s]);
  assert.deepEqual(plugins[0].extra.bundled_skills, []);
  assert.deepEqual(skills[0].bundled_in_plugins, []);
});

test('Task 8: manifest.agents populates bundled_agents', () => {
  const p = plugin({ extra: { manifest: { agents: ['agent-x'] } } });
  const { plugins } = linkBundles([p], []);
  assert.deepEqual(plugins[0].extra.bundled_agents, ['agent-x']);
});

test('Task 8: bundled_commands/hooks mechanical from component name lists', () => {
  const p = plugin({ extra: { commands: ['cmd-b', 'cmd-a'], hooks: ['hook-1'] } });
  const { plugins } = linkBundles([p], []);
  assert.deepEqual(plugins[0].extra.bundled_commands, ['cmd-a', 'cmd-b']);
  assert.deepEqual(plugins[0].extra.bundled_hooks, ['hook-1']);
});

test('Task 8: bundled_mcp_servers from colocated mcp_server entities', () => {
  const p = plugin();
  const m = { id: 'mcp_server:owner/repo/mcp-servers/x', entity_type: 'mcp_server', repo_full_name: 'owner/repo' };
  const { plugins } = linkBundles([p], [], { mcpServers: [m] });
  assert.deepEqual(plugins[0].extra.bundled_mcp_servers, ['mcp_server:owner/repo/mcp-servers/x']);
});

test('Task 8: nested plugin only bundles skills under its directory', () => {
  const p = plugin({
    id: 'plugin:owner/repo/packages/foo/.claude-plugin/plugin.json',
    extra: { plugin_path: 'packages/foo/.claude-plugin/plugin.json' },
  });
  const inside = skill('skill:owner/repo/packages/foo/skills/a/SKILL.md', 'owner/repo', 'packages/foo/skills/a/SKILL.md');
  const outside = skill('skill:owner/repo/skills/b/SKILL.md', 'owner/repo', 'skills/b/SKILL.md');
  const { plugins, skills } = linkBundles([p], [inside, outside]);
  assert.deepEqual(plugins[0].extra.bundled_skills, ['skill:owner/repo/packages/foo/skills/a/SKILL.md']);
  assert.deepEqual(skills.find((s) => s.id === inside.id).bundled_in_plugins, [p.id]);
  assert.deepEqual(skills.find((s) => s.id === outside.id).bundled_in_plugins, []);
});

test('Task 8: idempotent — two passes produce byte-identical output', () => {
  const mk = () => ({
    plugins: [plugin({ extra: { commands: ['c'], manifest: { agents: ['a'] } } })],
    skills: [skill('skill:owner/repo/skills/foo/SKILL.md', 'owner/repo', 'skills/foo/SKILL.md')],
  });
  const a = mk();
  const b = mk();
  linkBundles(a.plugins, a.skills);
  linkBundles(b.plugins, b.skills);
  // run b a second time
  linkBundles(b.plugins, b.skills);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('Task 8: multiple plugins on one skill accumulate sorted ascending', () => {
  const p2 = plugin({ id: 'plugin:owner/repo/b/.claude-plugin/plugin.json', extra: { plugin_path: 'b/.claude-plugin/plugin.json' } });
  const p1 = plugin({ id: 'plugin:owner/repo/.claude-plugin/plugin.json' }); // repo-root, bundles everything
  const s = skill('skill:owner/repo/b/skills/foo/SKILL.md', 'owner/repo', 'b/skills/foo/SKILL.md');
  const { skills } = linkBundles([p2, p1], [s]);
  assert.deepEqual(skills[0].bundled_in_plugins, [
    'plugin:owner/repo/.claude-plugin/plugin.json',
    'plugin:owner/repo/b/.claude-plugin/plugin.json',
  ]);
});
