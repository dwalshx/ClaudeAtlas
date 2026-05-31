/**
 * scripts/lib/embedding-input/__tests__/index.test.js
 *
 * Phase 3.2 Task 4 (D-09 + B-2). Tests the embedding-input registry and,
 * critically, the byte-identical parity guard for the skill builder
 * against the frozen legacy oracle over 10 hand-curated live records.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildEmbeddingInput,
  buildSkillEmbeddingInput,
  buildPluginEmbeddingInput,
  buildMcpEmbeddingInput,
} from '../index.js';
import { buildSkillEmbeddingInputLegacy } from './legacy-skill-builder.js';

const HERE = import.meta.dirname;

function loadFixture() {
  const path = join(HERE, 'fixtures', 'skills-live-10.ndjson');
  const fd = openSync(path, 'r');
  const buf = Buffer.alloc(1 << 20);
  let data = '';
  let bytes;
  while ((bytes = readSync(fd, buf, 0, buf.length, null)) > 0) {
    data += buf.toString('utf-8', 0, bytes);
  }
  closeSync(fd);
  return data
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l))
    .filter((r) => !r._header);
}

test('Task 4 / B-2: skill builder is byte-identical to the frozen legacy oracle', () => {
  const fixture = loadFixture();
  assert.ok(fixture.length >= 10, `expected >= 10 fixture records, got ${fixture.length}`);
  for (const rec of fixture) {
    const refactored = buildSkillEmbeddingInput(rec);
    const legacy = buildSkillEmbeddingInputLegacy(rec);
    assert.strictEqual(refactored, legacy, `embedding-input drift for ${rec.id}`);
  }
});

test('Task 4: plugin builder joins keywords with comma+space, length <= 200', () => {
  const rec = {
    entity_type: 'plugin',
    name: 'cool-plugin',
    description: 'does things',
    extra: { manifest: { keywords: ['a', 'b', 'c'] } },
  };
  const s = buildPluginEmbeddingInput(rec);
  assert.ok(s.includes('a, b, c'));
  assert.ok(s.length <= 200);
});

test('Task 4: mcp builder is well-formed when transport is null', () => {
  const rec = {
    entity_type: 'mcp_server',
    name: 'cool-mcp',
    description: 'serves tools',
    extra: { transport: null, tools: ['t1', 't2'] },
  };
  const s = buildMcpEmbeddingInput(rec);
  assert.ok(s.includes('transport=null'));
  assert.ok(s.includes('tools: t1, t2'));
  assert.ok(s.length <= 200);
});

test('Task 4: dispatch routes by entity_type', () => {
  const skill = { entity_type: 'skill', name: 'n', description: 'd', extra: { body_markdown: 'b' } };
  assert.equal(buildEmbeddingInput(skill), buildSkillEmbeddingInput(skill));
});

test('Task 4: dispatch throws on unknown entity_type', () => {
  assert.throws(() => buildEmbeddingInput({ entity_type: 'frobnicator' }), /no builder/);
});
