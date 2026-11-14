/**
 * scripts/__tests__/generate-llms-txt.test.js — Phase 4.3.
 *
 * renderTemplate(stats, apiSummary) is pure. With apiSummary = null (no
 * data/apis.ndjson on the build) the output carries no api content; with a
 * summary it gains the catalog count, the `type=api` filter, the API catalog
 * endpoints section and the /apis/ human links.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTemplate } from '../generate-llms-txt.js';

const STATS = {
  timestamp: '2026-11-14T06:30:00.000Z',
  total_discovered: 1000,
  total_skills: 500,
  tiers: { featured: 50, solid: 150, listed: 300 },
  plugin: { total_plugins: 20 },
  mcp_server: { total_mcp_servers: 5 },
};

const API_SUMMARY = { count: 4223, tiers: { featured: 422, solid: 1266, listed: 2535 } };

test('4.3: llms.txt without api data has no api content', () => {
  const out = renderTemplate(STATS, null);
  assert.match(out, /Catalog: 500 skills · 20 plugins · 5 MCP servers \(live\)\./);
  assert.ok(!out.includes('APIs (live)'));
  assert.ok(!out.includes('type=skill|plugin|mcp_server|api'));
  assert.ok(out.includes('type=skill|plugin|mcp_server`'));
  assert.ok(!out.includes('### API catalog'));
  assert.ok(!out.includes('apis-latest/apis.ndjson'));
  assert.ok(!out.includes('/api/v1/search?type=api'));
  assert.ok(!out.includes('- APIs: /apis/'));
  assert.ok(!out.includes('or "api"'));
});

test('4.3: llms.txt defaults apiSummary to null (pre-4.3 call shape)', () => {
  assert.equal(renderTemplate(STATS), renderTemplate(STATS, null));
});

test('4.3: llms.txt with api data adds count, type filter, API section and links', () => {
  const out = renderTemplate(STATS, API_SUMMARY);
  assert.match(out, /Catalog: 500 skills · 20 plugins · 5 MCP servers · 4,223 APIs \(live\)\./);
  assert.ok(out.includes('`type=skill|plugin|mcp_server|api`'));
  assert.ok(out.includes('or "api"'));
  assert.ok(out.includes('### API catalog (data feeds)'));
  assert.ok(out.includes('4,223 public web APIs (422 Featured, 1,266 Solid,\n2,535 Listed)'));
  assert.ok(out.includes('https://claudeatlas.com/apis/'));
  assert.ok(out.includes('https://claudeatlas.com/api/v1/search?type=api&q={query}'));
  assert.ok(out.includes('https://github.com/dwalshx/ClaudeAtlas/releases/download/apis-latest/apis.ndjson'));
  assert.ok(out.includes('https://claudeatlas.com/methodology/#data-feed-scoring'));
  assert.ok(out.includes('- APIs: /apis/ (index)'));
  // The API section sits inside Endpoints, before the telemetry endpoint.
  assert.ok(out.indexOf('### API catalog') < out.indexOf('### Search Query Log'));
  assert.ok(out.indexOf('### Full Catalog Registry') < out.indexOf('### API catalog'));
});

test('4.3: llms.txt api count ignores pipeline-stats api section when no file ships', () => {
  // A stats api section without apis.ndjson (e.g. failed apis-latest fetch)
  // must not advertise API pages the build did not render.
  const out = renderTemplate({ ...STATS, api: { total_apis: 4223 } }, null);
  assert.ok(!out.includes('APIs (live)'));
  assert.ok(!out.includes('### API catalog'));
});
