/**
 * worker/search-results.test.js — PR #26: per-entity-type search result links
 * and the untyped-search post-filter for api/dataset hits.
 *
 * search-results.js is pure (zero imports), so it runs under plain
 * `node --test`. NEVER import worker/index.js here — it uses bare JSON imports
 * that esbuild handles but plain Node cannot; its wiring (semanticSearch →
 * shapeSearchResults / vectorTopK) is verified by grep, the Wave 1 convention.
 * The handler-level tests drive mcp.js handleMcpRequest with a stub
 * semanticSearch that runs the real shapeSearchResults, plus
 * renderSkillMarkdown directly.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  detailPathFor, shapeSearchResults, vectorTopK, HIDDEN_FROM_UNTYPED_SEARCH, DETAIL_PREFIX, UNTYPED_OVERFETCH,
} from './search-results.js';
import { handleMcpRequest } from './mcp.js';
import { renderSkillMarkdown } from './markdown.js';

const match = (slug, score, entity_type) => ({
  score,
  metadata: { slug, name: slug, ...(entity_type ? { entity_type } : {}) },
});

test('PR #26: detailPathFor maps every entity_type to its page prefix', () => {
  assert.equal(detailPathFor('skill', 'a/b'), '/skills/a/b/');
  assert.equal(detailPathFor('plugin', 'o/p'), '/plugins/o/p/');
  assert.equal(detailPathFor('mcp_server', 'o/m'), '/mcp/o/m/');
  assert.equal(detailPathFor('api', 'stripe.com/stripe'), '/apis/stripe.com/stripe/');
  assert.equal(detailPathFor('dataset', 'huggingface/squad'), '/datasets/huggingface/squad/');
  assert.deepEqual(Object.keys(DETAIL_PREFIX).sort(), ['api', 'dataset', 'mcp_server', 'plugin', 'skill']);
});

test('PR #26: unknown or missing entity_type falls back to /skills/ (legacy vectors)', () => {
  assert.equal(detailPathFor(undefined, 'a/b'), '/skills/a/b/');
  assert.equal(detailPathFor(null, 'a/b'), '/skills/a/b/');
  assert.equal(detailPathFor('command_lib', 'a/b'), '/skills/a/b/');
  const [r] = shapeSearchResults([match('legacy/x', 0.9)], { topK: 5 });
  assert.equal(r.entity_type, 'skill');
  assert.equal(r.detail_url, '/skills/legacy/x/');
});

test('PR #26: shapeSearchResults builds detail_url per type and keeps same-slug hits of different types', () => {
  const results = shapeSearchResults([
    match('o/x', 0.8, 'plugin'),
    match('o/x', 0.7, 'skill'),
    match('o/x', 0.6, 'skill'),
    match('o/m', 0.5, 'mcp_server'),
  ], { topK: 10 });
  assert.deepEqual(results.map((r) => [r.entity_type, r.detail_url, r.score]), [
    ['plugin', '/plugins/o/x/', 0.8],
    ['skill', '/skills/o/x/', 0.7],
    ['mcp_server', '/mcp/o/m/', 0.5],
  ]);
});

test('PR #26: untyped search excludes api/dataset hits and still fills the page from the over-fetch', () => {
  assert.deepEqual([...HIDDEN_FROM_UNTYPED_SEARCH], ['api', 'dataset']);
  const matches = [
    match('stripe.com/stripe', 0.99, 'api'),
    match('huggingface/squad', 0.98, 'dataset'),
    ...Array.from({ length: 12 }, (_, i) => match(`s/k${i}`, 0.9 - i / 100, i % 3 === 0 ? undefined : 'skill')),
  ];
  const results = shapeSearchResults(matches, { filterType: null, topK: 10 });
  assert.equal(results.length, 10, 'page of 10 stays full after dropping 2 hidden hits');
  assert.ok(results.every((r) => !HIDDEN_FROM_UNTYPED_SEARCH.includes(r.entity_type)));
  assert.ok(results.every((r) => !r.detail_url.startsWith('/apis/') && !r.detail_url.startsWith('/datasets/')));
  assert.equal(vectorTopK(10, null), 10 + UNTYPED_OVERFETCH);
  assert.equal(vectorTopK(45, null, 50), 50, 'capped at the Vectorize max');
  assert.equal(vectorTopK(10, 'api'), 10, 'no over-fetch when typed');
});

test('PR #26: an explicit ?type=api returns api hits with /apis/ links', () => {
  const results = shapeSearchResults([match('stripe.com/stripe', 0.99, 'api'), match('openai.com/openai', 0.9, 'api')], { filterType: 'api', topK: 10 });
  assert.deepEqual(results.map((r) => r.detail_url), ['/apis/stripe.com/stripe/', '/apis/openai.com/openai/']);
  const ds = shapeSearchResults([match('huggingface/squad', 0.9, 'dataset')], { filterType: 'dataset', topK: 10 });
  assert.equal(ds[0].detail_url, '/datasets/huggingface/squad/');
});

test('PR #26: worker/index.js semanticSearch is wired to shapeSearchResults + vectorTopK (no hardcoded /skills/ detail_url)', () => {
  const src = readFileSync(join(import.meta.dirname, 'index.js'), 'utf-8');
  assert.ok(src.includes("import { shapeSearchResults, vectorTopK } from './search-results.js'"));
  assert.ok(src.includes('topK: vectorTopK(topK, filterType, SEARCH_MAX_K)'));
  assert.ok(src.includes('shapeSearchResults(matches, { filterType, topK })'));
  assert.ok(!src.includes('detail_url: `/skills/'), 'no hardcoded /skills/ detail_url left');
});

function mcpRequest(body) {
  return new Request('https://claudeatlas.com/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify(body),
  });
}

async function mcpResult(res) {
  const text = await res.text();
  const json = JSON.parse(text.startsWith('{') ? text : text.replace(/^[\s\S]*?data: /, ''));
  return JSON.parse(json.result.content[0].text);
}

test('PR #26: MCP search_skills (untyped) returns per-type links and never api/dataset hits', async () => {
  const stubMatches = [
    match('stripe.com/stripe', 0.99, 'api'),
    match('o/p', 0.9, 'plugin'),
    match('o/m', 0.8, 'mcp_server'),
    match('s/k', 0.7),
  ];
  const semanticSearch = async (req) => {
    const u = new URL(req.url);
    const results = shapeSearchResults(stubMatches, { filterType: u.searchParams.get('type'), topK: Number(u.searchParams.get('k')) });
    return new Response(JSON.stringify({ query: u.searchParams.get('q'), count: results.length, results, source: 'test' }), { status: 200 });
  };
  const res = await handleMcpRequest(
    mcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'search_skills', arguments: { query: 'payments', limit: 10 } } }),
    {}, undefined, { semanticSearch },
  );
  const out = await mcpResult(res);
  assert.deepEqual(out.results.map((r) => r.detail_url), ['/plugins/o/p/', '/mcp/o/m/', '/skills/s/k/']);
});

test('PR #26: MCP get_skill and the markdown rendition build detail_url from entity_type (fallback /skills/)', async () => {
  const env = {
    SKILLS_KV: {
      async get(slug) {
        return JSON.stringify({ slug, name: 'x', entity_type: slug.startsWith('plug') ? 'plugin' : undefined, repo_full_name: 'o/r' });
      },
    },
  };
  const res = await handleMcpRequest(
    mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_skill', arguments: { slug: 'plug/x' } } }),
    env, undefined, {},
  );
  assert.equal((await mcpResult(res)).detail_url, 'https://claudeatlas.com/plugins/plug/x/');
  const res2 = await handleMcpRequest(
    mcpRequest({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_skill', arguments: { slug: 'o/s' } } }),
    env, undefined, {},
  );
  assert.equal((await mcpResult(res2)).detail_url, 'https://claudeatlas.com/skills/o/s/');
  assert.ok(renderSkillMarkdown({ slug: 'o/m', name: 'm', entity_type: 'mcp_server' }).includes('https://claudeatlas.com/mcp/o/m/'));
  assert.ok(renderSkillMarkdown({ slug: 'o/s', name: 's' }).includes('https://claudeatlas.com/skills/o/s/'));
});
