/**
 * scripts/__tests__/generate-feeds.test.js
 *
 * Phase 3.2 Task 11 (D-06). Feeds become mixed-type: each item carries
 * _claudeatlas.type_chip = entity_type. Ranking is type-agnostic. We test the
 * pure builders (buildWhatsNew / buildItem) over a mixed entity array.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWhatsNew, buildItem } from '../generate-feeds.js';

function entity(entityType, name, overrides = {}) {
  return {
    id: `${entityType}:owner/${name}/x`,
    slug: `owner/${name}`,
    entity_type: entityType,
    name,
    description: `A useful ${entityType} called ${name} for daily ecosystem work.`,
    repo_full_name: `owner/${name}`,
    repo_stars: 100,
    quality_tier: 'featured',
    quality_score: 80,
    is_duplicate: false,
    repo_created_at: new Date().toISOString(),
    tags: [`category:general`],
    ...overrides,
  };
}

test('Task 11: buildItem sets _claudeatlas.type_chip to the entity_type', () => {
  assert.equal(buildItem(entity('skill', 's')).  _claudeatlas.type_chip, 'skill');
  assert.equal(buildItem(entity('plugin', 'p'))._claudeatlas.type_chip, 'plugin');
  assert.equal(buildItem(entity('mcp_server', 'm'))._claudeatlas.type_chip, 'mcp_server');
});

test('Task 11: whats-new feed contains at least 1 entry per type for mixed input', () => {
  const entities = [
    entity('skill', 'alpha'),
    entity('plugin', 'beta'),
    entity('mcp_server', 'gamma'),
  ];
  const feed = buildWhatsNew(entities);
  const chips = new Set(feed.items.map((i) => i._claudeatlas.type_chip));
  assert.ok(chips.has('skill'), 'has a skill entry');
  assert.ok(chips.has('plugin'), 'has a plugin entry');
  assert.ok(chips.has('mcp_server'), 'has an mcp_server entry');
  assert.equal(feed.items.length, 3);
});
