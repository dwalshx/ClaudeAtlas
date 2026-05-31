/**
 * scripts/__tests__/link-bundles.test.js
 *
 * Phase 3.2 Task 8. Integration coverage for the link-bundles.js orchestrator:
 * it reads the three NDJSON files, links bundles, and rewrites skills/plugins
 * ATOMICALLY (tmp+rename via writeNdjsonStreaming). Re-running is idempotent
 * on disk. `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeNdjsonStreaming, readNdjsonRecords } from '../lib/ndjson.js';
import { buildHeader } from '../lib/entity-version.js';
import { linkBundles } from '../lib/bundled-links.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'link-bundles-'));
  const skills = [{
    id: 'skill:owner/repo/skills/foo/SKILL.md',
    entity_type: 'skill',
    repo_full_name: 'owner/repo',
    bundled_in_plugins: [],
    extra: { type: 'skill', skill_path: 'skills/foo/SKILL.md' },
  }];
  const plugins = [{
    id: 'plugin:owner/repo/.claude-plugin/plugin.json',
    entity_type: 'plugin',
    repo_full_name: 'owner/repo',
    extra: { type: 'plugin', plugin_path: '.claude-plugin/plugin.json', manifest: {}, commands: [], hooks: [], bundled_skills: [], bundled_agents: [], bundled_commands: [], bundled_hooks: [], bundled_mcp_servers: [] },
  }];
  const sPath = join(dir, 'skills.ndjson');
  const pPath = join(dir, 'plugins.ndjson');
  writeNdjsonStreaming(sPath, skills, { header: buildHeader('skill') });
  writeNdjsonStreaming(pPath, plugins, { header: buildHeader('plugin') });
  return { dir, sPath, pPath };
}

test('Task 8: tmp+rename leaves no .tmp artifact, output is valid NDJSON', () => {
  const { dir, sPath, pPath } = setup();
  try {
    const skills = [...readNdjsonRecords(sPath, { keyFn: (r) => r.id }).values()];
    const plugins = [...readNdjsonRecords(pPath, { keyFn: (r) => r.id }).values()];
    linkBundles(plugins, skills);
    writeNdjsonStreaming(sPath, skills, { header: buildHeader('skill') });
    writeNdjsonStreaming(pPath, plugins, { header: buildHeader('plugin') });

    assert.ok(!existsSync(sPath + '.tmp'), 'no skills .tmp left behind');
    assert.ok(!existsSync(pPath + '.tmp'), 'no plugins .tmp left behind');

    const reSkills = [...readNdjsonRecords(sPath, { keyFn: (r) => r.id }).values()];
    const rePlugins = [...readNdjsonRecords(pPath, { keyFn: (r) => r.id }).values()];
    assert.deepEqual(reSkills[0].bundled_in_plugins, ['plugin:owner/repo/.claude-plugin/plugin.json']);
    assert.deepEqual(rePlugins[0].extra.bundled_skills, ['skill:owner/repo/skills/foo/SKILL.md']);
    // header sentinel present on line 1
    const firstLine = readFileSync(pPath, 'utf-8').split('\n')[0];
    assert.equal(JSON.parse(firstLine)._header, true);
    assert.equal(JSON.parse(firstLine).entity_type, 'plugin');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Task 8: on-disk idempotency — second link+write byte-identical', () => {
  const { dir, sPath, pPath } = setup();
  try {
    const run = () => {
      const skills = [...readNdjsonRecords(sPath, { keyFn: (r) => r.id }).values()];
      const plugins = [...readNdjsonRecords(pPath, { keyFn: (r) => r.id }).values()];
      linkBundles(plugins, skills);
      writeNdjsonStreaming(sPath, skills, { header: buildHeader('skill') });
      writeNdjsonStreaming(pPath, plugins, { header: buildHeader('plugin') });
    };
    run();
    // bodies excluding the volatile generated_at header field
    const body = (p) => readFileSync(p, 'utf-8').split('\n').slice(1).join('\n');
    const s1 = body(sPath); const p1 = body(pPath);
    run();
    assert.equal(body(sPath), s1);
    assert.equal(body(pPath), p1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
