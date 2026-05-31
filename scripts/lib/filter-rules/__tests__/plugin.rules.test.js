/**
 * scripts/lib/filter-rules/__tests__/plugin.rules.test.js
 *
 * Phase 3.2 Task 2. Plugin slop gates (D-05):
 *   - HAS_MANIFEST_OR_LISTING
 *   - COMPONENT_FLOOR (>= 1 component across commands/hooks/bundled_*)
 *   - MIN_DESCRIPTION_LENGTH (50)
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPluginSlop } from '../plugin.rules.js';
import { isSlop } from '../index.js';

function basePlugin(topOverrides = {}, extraOverrides = {}) {
  return {
    entity_type: 'plugin',
    name: 'cool-plugin',
    description: 'A genuinely useful plugin that does many helpful things for users.',
    body_length: 1200,
    ...topOverrides,
    extra: {
      type: 'plugin',
      manifest: { name: 'cool-plugin', version: '1.0.0' },
      marketplace_listings: [],
      commands: ['cmd-a'],
      hooks: [],
      bundled_skills: [],
      bundled_agents: [],
      bundled_commands: [],
      bundled_hooks: [],
      bundled_mcp_servers: [],
      ...extraOverrides,
    },
  };
}

test('Task 2: valid plugin (has manifest + components + long desc) passes', () => {
  assert.equal(isPluginSlop(basePlugin()), false);
});

test('Task 2: manifestless but marketplace-listed plugin passes', () => {
  const rec = basePlugin({}, { manifest: {}, marketplace_listings: ['owner/marketplace'] });
  assert.equal(isPluginSlop(rec), false);
});

test('Task 2: manifestless AND unlisted plugin is rejected', () => {
  const rec = basePlugin({}, { manifest: {}, marketplace_listings: [] });
  assert.equal(isPluginSlop(rec), true);
});

test('Task 2: empty-component plugin is rejected (COMPONENT_FLOOR)', () => {
  const rec = basePlugin({}, {
    commands: [], hooks: [], bundled_skills: [], bundled_agents: [],
    bundled_commands: [], bundled_hooks: [], bundled_mcp_servers: [],
  });
  assert.equal(isPluginSlop(rec), true);
});

test('Task 2: short-description plugin is rejected (MIN_DESCRIPTION_LENGTH)', () => {
  const rec = basePlugin({ description: 'too short' });
  assert.equal(isPluginSlop(rec), true);
});

test('Task 2: dispatcher routes entity_type=plugin to isPluginSlop', () => {
  const good = basePlugin();
  const bad = basePlugin({}, { manifest: {}, marketplace_listings: [] });
  assert.equal(isSlop(good), false);
  assert.equal(isSlop(bad), true);
});
