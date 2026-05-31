/**
 * scripts/lib/scorers/__tests__/plugin.scorer.test.js
 *
 * Phase 3.2 Task 3. Plugin 7-signal scorer with Manifest-Completeness
 * swap (D-03). Asserts the manifest_completeness side-effect and that a
 * strong record reaches the Featured score range.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scorePlugin } from '../plugin.scorer.js';
import { scoreEntity } from '../index.js';

function basePlugin(manifest, overrides = {}) {
  return {
    entity_type: 'plugin',
    name: 'cool-plugin',
    description: 'A genuinely useful plugin that does many helpful things for users daily.',
    repo_stars: 1500,
    repo_open_issues: 2,
    repo_license: 'MIT',
    repo_description: 'A high quality plugin repo with a meaningful description here.',
    repo_pushed_at: new Date().toISOString(),
    body_length: 2500,
    extra: {
      type: 'plugin',
      manifest,
      readme_markdown: 'x'.repeat(2500),
      marketplace_listings: [],
      commands: ['cmd-a'],
      hooks: [],
      bundled_skills: [],
      bundled_agents: [],
      bundled_commands: [],
      bundled_hooks: [],
      bundled_mcp_servers: [],
      ...(overrides.extra || {}),
    },
    ...overrides,
  };
}

test('Task 3: perfect manifest → manifest_completeness=1.0 and Featured-range score', () => {
  const rec = basePlugin({
    name: 'cool-plugin',
    version: '1.0.0',
    author: 'owner',
    license: 'MIT',
    keywords: ['productivity'],
    description: 'A genuinely useful plugin that does many helpful things daily.',
  });
  const score = scorePlugin(rec);
  assert.equal(rec.extra.manifest_completeness, 1.0);
  assert.ok(score >= 80, `expected Featured-range (>=80), got ${score}`);
});

test('Task 3: minimal manifest (desc only) → manifest_completeness ~= 0.2', () => {
  const rec = basePlugin({
    description: 'A genuinely useful plugin that does many helpful things daily.',
  });
  scorePlugin(rec);
  assert.ok(
    Math.abs(rec.extra.manifest_completeness - 0.2) < 0.01,
    `expected ~0.2, got ${rec.extra.manifest_completeness}`,
  );
});

test('Task 3: scorePlugin returns a 0-100 integer', () => {
  const rec = basePlugin({ name: 'x', version: '1.0.0' });
  const score = scorePlugin(rec);
  assert.ok(Number.isInteger(score) && score >= 0 && score <= 100);
});

test('Task 3: dispatcher routes entity_type=plugin to scorePlugin', () => {
  const rec = basePlugin({ name: 'x', version: '1.0.0', author: 'o', license: 'MIT', keywords: ['k'], description: 'a'.repeat(60) });
  assert.equal(scoreEntity(rec), scorePlugin(basePlugin({ name: 'x', version: '1.0.0', author: 'o', license: 'MIT', keywords: ['k'], description: 'a'.repeat(60) })));
});
