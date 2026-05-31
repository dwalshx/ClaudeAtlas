/**
 * scripts/lib/recipes/__tests__/index.test.js
 *
 * Phase 3.2 Task 5 (D-10 / F-7). Plugin + MCP recipes are SHAPE-CONFORMANT
 * STUBS: they carry the DiscoveryRecipe shape but discover() is an empty
 * generator (production discovery lives in scripts/scrape-plugins.js).
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recipes } from '../index.js';
import { pluginRecipe } from '../plugin.recipe.js';
import { mcpRecipe } from '../mcp.recipe.js';

function assertRecipeShape(r) {
  assert.equal(typeof r.entity_type, 'string');
  assert.equal(typeof r.output_path, 'string');
  assert.equal(typeof r.state_path, 'string');
  assert.equal(typeof r.discover, 'function');
  assert.equal(typeof r.parse, 'function');
  assert.equal(typeof r.computeId, 'function');
}

test('Task 5: registry exposes plugin + mcp_server recipes', () => {
  assert.equal(recipes.plugin, pluginRecipe);
  assert.equal(recipes.mcp_server, mcpRecipe);
});

test('Task 5: plugin recipe conforms to DiscoveryRecipe shape', () => {
  assertRecipeShape(pluginRecipe);
  assert.equal(pluginRecipe.entity_type, 'plugin');
});

test('Task 5: mcp recipe conforms to DiscoveryRecipe shape', () => {
  assertRecipeShape(mcpRecipe);
  assert.equal(mcpRecipe.entity_type, 'mcp_server');
});

test('Task 5: plugin computeId produces canonical id', () => {
  const rec = { repo_full_name: 'owner/repo', extra: { plugin_path: '.claude-plugin/plugin.json' } };
  assert.equal(pluginRecipe.computeId(rec), 'plugin:owner/repo/.claude-plugin/plugin.json');
});

test('Task 5: mcp computeId produces canonical id', () => {
  const rec = { repo_full_name: 'owner/repo', extra: { server_path: 'server' } };
  assert.equal(mcpRecipe.computeId(rec), 'mcp_server:owner/repo/server');
});

test('Task 5: discover() yields zero items (stub contract)', async () => {
  for (const r of [pluginRecipe, mcpRecipe]) {
    const items = [];
    for await (const it of r.discover()) items.push(it);
    assert.equal(items.length, 0);
  }
});
