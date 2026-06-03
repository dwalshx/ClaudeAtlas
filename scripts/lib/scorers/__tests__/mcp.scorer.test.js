/**
 * scripts/lib/scorers/__tests__/mcp.scorer.test.js
 *
 * Phase 3.2 Task 3. MCP 7-signal scorer with MCP Manifest-Completeness
 * swap (D-03): description>=50 + transport declared + >=1 tool.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreMcp } from '../mcp.scorer.js';
import { scoreEntity } from '../index.js';

function baseMcp(overrides = {}) {
  return {
    entity_type: 'mcp_server',
    name: 'cool-mcp',
    description: 'An MCP server that exposes a useful set of tools over stdio transport.',
    repo_stars: 800,
    repo_open_issues: 1,
    repo_license: 'Apache-2.0',
    repo_description: 'A solid MCP server repo with a meaningful description here.',
    repo_pushed_at: new Date().toISOString(),
    body_length: 1500,
    extra: {
      type: 'mcp_server',
      manifest: {},
      readme_markdown: 'x'.repeat(1800),
      tools: ['tool-a', 'tool-b', 'tool-c'],
      transport: 'stdio',
      ...(overrides.extra || {}),
    },
    ...overrides,
  };
}

test('Task 3: stdio + 3 tools + long desc → manifest_completeness=1.0', () => {
  const rec = baseMcp();
  const score = scoreMcp(rec);
  assert.equal(rec.extra.manifest_completeness, 1.0);
  assert.ok(score >= 0 && score <= 100);
});

test('Task 3: null transport → manifest_completeness drops (transport contributes 0)', () => {
  const rec = baseMcp({ extra: { manifest: {}, readme_markdown: 'x'.repeat(1800), tools: ['t'], transport: null } });
  scoreMcp(rec);
  // desc(1/3) + tools(1/3) present, transport(1/3) absent → ~0.667
  assert.ok(
    Math.abs(rec.extra.manifest_completeness - (2 / 3)) < 0.01,
    `expected ~0.667, got ${rec.extra.manifest_completeness}`,
  );
});

test('Task 3: scoreMcp returns a 0-100 integer', () => {
  const score = scoreMcp(baseMcp());
  assert.ok(Number.isInteger(score) && score >= 0 && score <= 100);
});

test('Task 3: dispatcher routes entity_type=mcp_server to scoreMcp', () => {
  assert.equal(scoreEntity(baseMcp()), scoreMcp(baseMcp()));
});
