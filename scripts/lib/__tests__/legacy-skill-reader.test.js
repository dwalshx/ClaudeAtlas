/**
 * scripts/lib/__tests__/legacy-skill-reader.test.js
 *
 * Phase 3.2 Task 6. Verifies the upcaster dispatches by entity_type:
 *   - v1 skill (no schema_version) → EntityRecord<SkillExtra> (regression)
 *   - v1 plugin → EntityRecord<PluginExtra> with 3.2 defaults
 *   - v1 mcp_server → EntityRecord<McpExtra> with transport
 *   - v2 records pass through unchanged
 *
 * Phase 4.1 Plan 04 (4.1-M02 / 4.1-M03, D-02 / D-03 / D-05) extends it:
 *   - skill/plugin/mcp_server upcasts carry a github `origin`, `home_url`,
 *     `docs_url`, and NEVER null coerced `repo_*`
 *   - v2 passthrough back-fills origin/home_url/docs_url IN PLACE (Pitfall 1)
 *   - api/dataset upcast paths: `repo_*` null only when no repo is known,
 *     top-level `access` unknown-first, D-05 ids, no `undefined` anywhere
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { upcastRecord } from '../legacy-skill-reader.js';

// All sixteen EntityCommon repo_* keys (src/lib/types.d.ts).
const REPO_KEYS = [
  'repo_full_name', 'repo_url', 'repo_stars', 'repo_forks', 'repo_open_issues',
  'repo_topics', 'repo_license', 'repo_language', 'repo_created_at',
  'repo_updated_at', 'repo_pushed_at', 'repo_owner_type', 'repo_owner_avatar',
  'repo_archived', 'repo_is_fork', 'repo_description',
];
// The 13 keys the github-origin paths COERCE to ''/0/[]/'User'/false.
// repo_license / repo_language / repo_description are `?? null` on EVERY
// type and ARE null on the minimal inputs below (plan revision 1 / B2).
const REPO_KEYS_COERCED = REPO_KEYS.filter(
  (k) => !['repo_license', 'repo_language', 'repo_description'].includes(k),
);

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

// ---------------------------------------------------------------------------
// Phase 4.1 Plan 04 — D-02 origin on every record, nullable repo_* only for
// non-GitHub origins.
// ---------------------------------------------------------------------------

test('4.1-M02: skill/plugin/mcp_server upcasts carry github origin, home_url = repo_url, docs_url null, no null coerced repo_*', () => {
  const inputs = [
    { name: 's', repo_full_name: 'o/r', repo_url: 'https://github.com/o/r', skill_path: 'skills/s/SKILL.md' },
    { entity_type: 'plugin', name: 'p', repo_full_name: 'o/r', repo_url: 'https://github.com/o/r' },
    { entity_type: 'mcp_server', name: 'm', repo_full_name: 'o/r', repo_url: 'https://github.com/o/r' },
  ];
  for (const input of inputs) {
    const v2 = upcastRecord(input);
    assert.deepEqual(v2.origin, {
      kind: 'github',
      source: 'github',
      source_id: 'o/r',
      source_url: 'https://github.com/o/r',
      also_listed_in: [],
    }, `${v2.entity_type} origin`);
    assert.equal(v2.home_url, 'https://github.com/o/r', `${v2.entity_type} home_url`);
    assert.equal(v2.docs_url, null, `${v2.entity_type} docs_url`);
    for (const k of REPO_KEYS) assert.notEqual(v2[k], undefined, `${v2.entity_type}.${k} undefined`);
    for (const k of REPO_KEYS_COERCED) assert.notEqual(v2[k], null, `${v2.entity_type}.${k} null`);
    assert.ok(!('access' in v2), `${v2.entity_type} must not carry access`);
    // Legacy-default spot checks — the github-origin coercions are byte-identical to pre-4.1.
    assert.equal(v2.repo_stars, 0);
    assert.equal(v2.repo_owner_type, 'User');
    assert.equal(v2.repo_pushed_at, '');
  }
});

test('4.1-M02 / Pitfall 1: v2 passthrough back-fills origin/home_url/docs_url in place, identity preserved, existing origin untouched', () => {
  const a = {
    schema_version: 2,
    entity_type: 'skill',
    id: 'skill:o/r/x',
    repo_full_name: 'o/r',
    repo_url: 'https://github.com/o/r',
    extra: { type: 'skill' },
  };
  const outA = upcastRecord(a);
  assert.equal(outA, a);
  assert.equal(a.origin.kind, 'github');
  assert.equal(a.origin.source_id, 'o/r');
  assert.equal(a.home_url, 'https://github.com/o/r');
  assert.equal(a.docs_url, null);

  const keep = { kind: 'registry', source: 'apis.guru', source_id: 'x', source_url: 'https://x', also_listed_in: [] };
  const b = {
    schema_version: 2,
    entity_type: 'api',
    id: 'api:x/y',
    origin: keep,
    home_url: 'https://y',
    docs_url: 'https://d',
    extra: { type: 'api' },
  };
  upcastRecord(b);
  assert.equal(b.origin, keep);
  assert.equal(b.home_url, 'https://y');
});
