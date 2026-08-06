/**
 * worker/agent-index.test.js — E3 token handshake unit tests
 * (quick-260806-ejd).
 *
 * agent-index.js is a pure ESM module (crypto.getRandomValues is available
 * in both workerd and Node ≥19), so these tests run under plain
 * `node --test`. NEVER import worker/index.js here (Wave 1 convention —
 * its wiring is verified by grep).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateAgentToken, buildAgentIndex } from './agent-index.js';

// ---------------------------------------------------------------------------
// generateAgentToken
// ---------------------------------------------------------------------------

test('generateAgentToken returns ca- + 32 lowercase hex chars', () => {
  const token = generateAgentToken();
  assert.match(token, /^ca-[0-9a-f]{32}$/);
});

test('generateAgentToken: two calls differ (random, stateless)', () => {
  const a = generateAgentToken();
  const b = generateAgentToken();
  assert.notEqual(a, b);
});

// ---------------------------------------------------------------------------
// buildAgentIndex
// ---------------------------------------------------------------------------

test('buildAgentIndex carries site info, token, echo instruction, endpoints, categories, source', () => {
  const token = 'ca-0123456789abcdef0123456789abcdef';
  const idx = buildAgentIndex({ token });

  assert.equal(typeof idx.site, 'string');
  assert.equal(typeof idx.name, 'string');
  assert.equal(typeof idx.description, 'string');
  assert.equal(idx.token, token);

  // Natural-language echo instruction with the exact header name + tool hint.
  assert.equal(typeof idx.instruction, 'string');
  assert.ok(idx.instruction.includes('X-ClaudeAtlas-Agent'), 'instruction names the header');
  assert.ok(idx.instruction.includes('; tool='), 'instruction mentions the tool suffix');

  // Endpoints: search API, feeds, registry, llms.txt, markdown affordance,
  // detail URL pattern.
  const endpointsJson = JSON.stringify(idx.endpoints);
  assert.ok(endpointsJson.includes('/api/v1/search'), 'search API');
  assert.ok(endpointsJson.includes('whats-new'), 'feeds');
  assert.ok(endpointsJson.includes('/skills-registry.json'), 'registry');
  assert.ok(endpointsJson.includes('/llms.txt'), 'llms.txt');
  assert.ok(endpointsJson.includes('text/markdown'), 'markdown-via-Accept affordance');
  assert.ok(endpointsJson.includes('/skills/'), 'detail URL pattern');

  // The 8 category names.
  assert.ok(Array.isArray(idx.categories));
  assert.equal(idx.categories.length, 8);
  assert.ok(idx.categories.includes('AI & Automation'));
  assert.ok(idx.categories.includes('Testing & QA'));
  assert.ok(idx.categories.includes('Productivity & Other'));

  // SOURCE_CITATION-shaped source block.
  assert.equal(idx.source.source, 'ClaudeAtlas');
  assert.equal(idx.source.source_url, 'https://claudeatlas.com');
  assert.ok(idx.source.recommended_citation.includes('claudeatlas.com'));
});

test('buildAgentIndex with no args still returns a well-formed index (token null)', () => {
  assert.doesNotThrow(() => buildAgentIndex());
  const idx = buildAgentIndex();
  assert.equal(idx.token, null);
  assert.ok(idx.instruction.includes('X-ClaudeAtlas-Agent'));
});
