/**
 * scripts/lib/__tests__/legacy-skill-reader.test.js
 *
 * Phase 3.2 Task 6. Verifies the upcaster dispatches by entity_type:
 *   - v1 skill (no schema_version) → EntityRecord<SkillExtra> (regression)
 *   - v1 plugin → EntityRecord<PluginExtra> with 3.2 defaults
 *   - v1 mcp_server → EntityRecord<McpExtra> with transport
 *   - v2 records pass through unchanged
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcastRecord } from '../legacy-skill-reader.js';

test('Task 6: v1 skill upcasts to EntityRecord<SkillExtra>', () => {
  const v1 = {
    name: 'pdf-skill',
    description: 'reads pdfs',
    repo_full_name: 'owner/repo',
    skill_path: 'skills/pdf/SKILL.md',
    body_markdown: 'body',
    frontmatter: { name: 'pdf-skill' },
    has_name: true,
    has_description: true,
    category: 'AI & Automation',
  };
  const v2 = upcastRecord(v1);
  assert.equal(v2.entity_type, 'skill');
  assert.equal(v2.schema_version, 2);
  assert.equal(v2.extra.type, 'skill');
  assert.equal(v2.extra.skill_path, 'skills/pdf/SKILL.md');
  assert.ok(Array.isArray(v2.bundled_in_plugins));
  // dual-shape back-compat preserved
  assert.equal(v2.body_markdown, 'body');
});

test('Task 6: v1 plugin upcasts to EntityRecord<PluginExtra> with 3.2 defaults', () => {
  const v1 = {
    entity_type: 'plugin',
    name: 'cool-plugin',
    description: 'a plugin',
    repo_full_name: 'owner/repo',
    plugin_path: '.claude-plugin/plugin.json',
    manifest: { name: 'cool-plugin', version: '1.0.0' },
    readme_markdown: 'readme',
    commands: ['cmd-a'],
    hooks: [],
  };
  const v2 = upcastRecord(v1);
  assert.equal(v2.entity_type, 'plugin');
  assert.equal(v2.schema_version, 2);
  assert.equal(v2.id, 'plugin:owner/repo/.claude-plugin/plugin.json');
  assert.equal(v2.extra.type, 'plugin');
  assert.equal(v2.extra.plugin_path, '.claude-plugin/plugin.json');
  assert.deepEqual(v2.extra.commands, ['cmd-a']);
  // 3.2 defaults
  assert.deepEqual(v2.extra.marketplace_listings, []);
  assert.deepEqual(v2.extra.bundled_skills, []);
  assert.deepEqual(v2.extra.bundled_mcp_servers, []);
  assert.equal(v2.extra.manifest_completeness, 0);
  assert.deepEqual(v2.bundled_in_plugins, []);
});

test('Task 6: v1 mcp_server upcasts to EntityRecord<McpExtra> with transport', () => {
  const v1 = {
    entity_type: 'mcp_server',
    name: 'cool-mcp',
    description: 'an mcp',
    repo_full_name: 'owner/repo',
    server_path: 'mcp-servers/frappe',
    manifest: {},
    tools: ['tool-a'],
    transport: 'stdio',
  };
  const v2 = upcastRecord(v1);
  assert.equal(v2.entity_type, 'mcp_server');
  assert.equal(v2.id, 'mcp_server:owner/repo/mcp-servers/frappe');
  assert.equal(v2.extra.type, 'mcp_server');
  assert.equal(v2.extra.transport, 'stdio');
  assert.deepEqual(v2.extra.tools, ['tool-a']);
  assert.equal(v2.extra.manifest_completeness, 0);
});

test('Task 6: mcp_server with missing transport defaults to null', () => {
  const v2 = upcastRecord({
    entity_type: 'mcp_server',
    name: 'x',
    repo_full_name: 'o/r',
    server_path: 's',
  });
  assert.equal(v2.extra.transport, null);
  assert.deepEqual(v2.extra.tools, []);
});

test('Task 6: v2 record passes through unchanged', () => {
  const v2in = {
    schema_version: 2,
    entity_type: 'plugin',
    id: 'plugin:o/r/p',
    extra: { type: 'plugin' },
  };
  assert.equal(upcastRecord(v2in), v2in);
});

test('Task 6: already-nested plugin input is handled defensively', () => {
  const v1 = {
    entity_type: 'plugin',
    name: 'p',
    repo_full_name: 'o/r',
    extra: {
      plugin_path: 'pp',
      manifest: { version: '1' },
      bundled_skills: ['skill:o/r/skills/a/SKILL.md'],
      manifest_completeness: 0.4,
    },
  };
  const v2 = upcastRecord(v1);
  assert.equal(v2.extra.plugin_path, 'pp');
  assert.deepEqual(v2.extra.bundled_skills, ['skill:o/r/skills/a/SKILL.md']);
  assert.equal(v2.extra.manifest_completeness, 0.4);
});
