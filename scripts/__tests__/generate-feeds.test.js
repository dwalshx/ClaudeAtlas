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
import { buildWhatsNew, buildNotable, buildItem, MAX_API_ITEMS_PER_FEED, capPerType } from '../generate-feeds.js';

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

// ---------------------------------------------------------------------------
// Phase 4.3: api records in feeds.
// ---------------------------------------------------------------------------

function apiEntity(name, overrides = {}) {
  const { extra: extraOverrides, ...rest } = overrides;
  return {
    id: `api:api.${name}.com/${name}`,
    slug: `${name}.com/${name}`,
    entity_type: 'api',
    name,
    description: `The ${name} REST API for programmatic access to ${name} data.`,
    repo_full_name: null,
    repo_stars: null,
    repo_created_at: null,
    quality_tier: 'featured',
    quality_score: 70,
    novelty_score: 0.6,
    is_duplicate: false,
    scraped_at: new Date().toISOString(),
    tags: ['category:api-and-backend'],
    access: { cost: { model: 'free' }, auth: { type: 'api_key' } },
    extra: {
      type: 'api',
      provider: `${name}.com`,
      source_modified_at: new Date(Date.now() - 2 * 86400000).toISOString(),
      ...(extraOverrides || {}),
    },
    ...rest,
  };
}

test('4.3: buildItem for an api links /apis/<slug>/ with type_chip api and api fields', () => {
  const item = buildItem(apiEntity('stripe'));
  assert.equal(item.url, 'https://claudeatlas.com/apis/stripe.com/stripe/');
  assert.equal(item._claudeatlas.type_chip, 'api');
  assert.equal(item._claudeatlas.creator, 'stripe.com');
  assert.equal(item._claudeatlas.provider, 'stripe.com');
  assert.equal(item._claudeatlas.repo_stars, null);
  assert.equal(item._claudeatlas.repo_full_name, null);
  assert.equal(item._claudeatlas.first_seen, null, 'no first-seen date exists for apis — never guessed');
  assert.equal(item._claudeatlas.cost_model, 'free');
  assert.equal(item._claudeatlas.auth_type, 'api_key');
  assert.ok(item._claudeatlas.source_modified_at);
  assert.equal(item.date_published, item._claudeatlas.source_modified_at);
});

test('4.3: buildItem for an api is null-safe (no extra, no access, no dates)', () => {
  const bare = { id: 'api:x.io/x', slug: 'x.io/x', entity_type: 'api', name: 'x' };
  const item = buildItem(bare);
  assert.equal(item.url, 'https://claudeatlas.com/apis/x.io/x/');
  assert.equal(item._claudeatlas.creator, '');
  assert.equal(item._claudeatlas.provider, null);
  assert.equal(item._claudeatlas.source_modified_at, null);
  assert.equal(item._claudeatlas.cost_model, 'unknown');
  assert.equal(item._claudeatlas.auth_type, 'unknown');
  assert.ok(!isNaN(Date.parse(item.date_published)));
});

test('4.3: skill items keep the /skills/ link and pre-4.3 fields (no api keys added)', () => {
  const item = buildItem(entity('skill', 's'));
  assert.equal(item.url, 'https://claudeatlas.com/skills/owner/s/');
  assert.equal(item._claudeatlas.repo_stars, 100);
  assert.ok(!('provider' in item._claudeatlas));
  assert.ok(!('cost_model' in item._claudeatlas));
});

test('4.3: whats-new windows apis on extra.source_modified_at, never on scraped_at', () => {
  const recent = apiEntity('recent');
  const stale = apiEntity('stale', { extra: { source_modified_at: '2023-04-01T00:00:00.000Z' } });
  // scraped_at is today on every harvest — must NOT make an undated api "new".
  const undated = apiEntity('undated', { extra: { source_modified_at: null } });
  const feed = buildWhatsNew([entity('skill', 'alpha'), recent, stale, undated]);
  const urls = feed.items.map((i) => i.url);
  assert.ok(urls.includes('https://claudeatlas.com/apis/recent.com/recent/'));
  assert.ok(!urls.includes('https://claudeatlas.com/apis/stale.com/stale/'));
  assert.ok(!urls.includes('https://claudeatlas.com/apis/undated.com/undated/'));
  const chips = new Set(feed.items.map((i) => i._claudeatlas.type_chip));
  assert.ok(chips.has('skill') && chips.has('api'));
});

test('4.3: notable includes a featured api modified in the last 7 days; skips duplicates', () => {
  const feed = buildNotable([
    apiEntity('fresh'),
    apiEntity('dupe', { is_duplicate: true }),
    apiEntity('old', { extra: { source_modified_at: new Date(Date.now() - 20 * 86400000).toISOString() } }),
  ]);
  assert.deepEqual(feed.items.map((i) => i.url), ['https://claudeatlas.com/apis/fresh.com/fresh/']);
});

test('4.3: feeds build cleanly with no api records (flag-off build)', () => {
  const feed = buildWhatsNew([entity('skill', 'alpha'), entity('plugin', 'beta')]);
  assert.equal(feed.items.length, 2);
  assert.ok(feed.items.every((i) => i._claudeatlas.type_chip !== 'api'));
  assert.equal(buildNotable([]).items.length, 0);
});

test('4.3: what\'s-new caps api items at MAX_API_ITEMS_PER_FEED so re-stamped listings cannot crowd out skills', () => {
  const apis = Array.from({ length: MAX_API_ITEMS_PER_FEED + 15 }, (_, i) => apiEntity(`a${i}`));
  const feed = buildWhatsNew([...apis, entity('skill', 'alpha')]);
  const types = feed.items.map((i) => i._claudeatlas.type_chip);
  assert.equal(types.filter((t) => t === 'api').length, MAX_API_ITEMS_PER_FEED);
  assert.ok(types.includes('skill'));
  const keep = capPerType('api', 1);
  assert.deepEqual([{ entity_type: 'api' }, { entity_type: 'skill' }, { entity_type: 'api' }].map(keep), [true, true, false]);
});

test('4.3: plugin and MCP feed items link to /plugins/ and /mcp/, not /skills/', () => {
  assert.equal(buildItem(entity('plugin', 'beta')).url.startsWith('https://claudeatlas.com/plugins/'), true);
  assert.equal(buildItem(entity('mcp_server', 'gamma')).url.startsWith('https://claudeatlas.com/mcp/'), true);
});
