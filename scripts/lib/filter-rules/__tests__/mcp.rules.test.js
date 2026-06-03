/**
 * scripts/lib/filter-rules/__tests__/mcp.rules.test.js
 *
 * Phase 3.2 Task 2. MCP slop gates (D-05):
 *   - HAS_TRANSPORT_DECLARED (extra.transport !== null)
 *   - tools.length >= 1
 *   - MIN_DESCRIPTION_LENGTH (50)
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMcpSlop } from '../mcp.rules.js';
import { isSlop } from '../index.js';

function baseMcp(topOverrides = {}, extraOverrides = {}) {
  return {
    entity_type: 'mcp_server',
    name: 'cool-mcp',
    description: 'An MCP server that exposes a useful set of tools over stdio transport.',
    body_length: 800,
    ...topOverrides,
    extra: {
      type: 'mcp_server',
      manifest: {},
      tools: ['tool-a', 'tool-b'],
      transport: 'stdio',
      ...extraOverrides,
    },
  };
}

test('Task 2: valid MCP (transport + tools + long desc) passes', () => {
  assert.equal(isMcpSlop(baseMcp()), false);
});

test('Task 2: transport=null MCP is rejected (HAS_TRANSPORT_DECLARED)', () => {
  assert.equal(isMcpSlop(baseMcp({}, { transport: null })), true);
});

test('Task 2: zero-tools MCP is rejected', () => {
  assert.equal(isMcpSlop(baseMcp({}, { tools: [] })), true);
});

test('Task 2: short-description MCP is rejected', () => {
  assert.equal(isMcpSlop(baseMcp({ description: 'short' })), true);
});

test('Task 2: dispatcher routes entity_type=mcp_server to isMcpSlop', () => {
  assert.equal(isSlop(baseMcp()), false);
  assert.equal(isSlop(baseMcp({}, { transport: null })), true);
});
