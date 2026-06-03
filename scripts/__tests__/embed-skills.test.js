/**
 * scripts/__tests__/embed-skills.test.js
 *
 * Phase 3.2 Task 9. embed-skills.js as the unified embedder for all three
 * entity_types. Subprocess-driven (EMBED_DRY_RUN=1) so no OpenAI calls.
 * Covers: deterministic plugin + mcp vectors, metadata.entity_type, the B-2
 * cache-hit pre-check (100% hit on re-run) and the drift-assertion bail-out.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNdjsonRecords } from '../lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const EMBED = join(ROOT, 'scripts', 'embed-skills.js');
const PLUGIN_FIXTURE = join(ROOT, 'data', '__fixtures__', 'plugins-mini.ndjson');
const MCP_FIXTURE = join(ROOT, 'data', '__fixtures__', 'mcp-mini.ndjson');

function runEmbed(args, env = {}) {
  return execFileSync('node', [EMBED, ...args], {
    cwd: ROOT,
    env: { ...process.env, EMBED_DRY_RUN: '1', ...env },
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function records(path) {
  return [...readNdjsonRecords(path, { keyFn: (r) => r.id }).values()];
}

test('Task 9: plugin dry-run produces deterministic vectors with metadata.entity_type', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-plugin-'));
  try {
    const out = join(dir, 'plugin-vectors.ndjson');
    runEmbed(['--input', PLUGIN_FIXTURE, '--output', out, '--entity-type', 'plugin']);
    const recs = records(out);
    assert.equal(recs.length, 3);
    for (const r of recs) {
      assert.equal(r.metadata.entity_type, 'plugin');
      assert.equal(r.values.length, 1536);
    }
    // Deterministic: a second run yields byte-identical values.
    const out2 = join(dir, 'plugin-vectors-2.ndjson');
    runEmbed(['--input', PLUGIN_FIXTURE, '--output', out2, '--entity-type', 'plugin']);
    const recs2 = records(out2);
    assert.deepEqual(recs[0].values, recs2[0].values);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Task 9: mcp dry-run tags metadata.entity_type=mcp_server', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-mcp-'));
  try {
    const out = join(dir, 'mcp-vectors.ndjson');
    runEmbed(['--input', MCP_FIXTURE, '--output', out, '--entity-type', 'mcp_server']);
    const recs = records(out);
    assert.equal(recs.length, 2);
    assert.ok(recs.every((r) => r.metadata.entity_type === 'mcp_server'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Task 9: B-2 cache-hit pre-check — 100% hit on unchanged re-run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-cache-'));
  try {
    const out = join(dir, 'plugin-vectors.ndjson');
    runEmbed(['--input', PLUGIN_FIXTURE, '--output', out, '--entity-type', 'plugin']);
    // Re-run against the SAME input + existing vectors → 100% hit, no re-embed.
    const log = runEmbed(['--input', PLUGIN_FIXTURE, '--output', out, '--entity-type', 'plugin']);
    assert.match(log, /cache hit rate: 100\.000%/);
    assert.match(log, /to embed:\s+0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Task 9: B-2 drift assertion fires below 99% without EMBED_FORCE_REEMBED', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-drift-'));
  try {
    const out = join(dir, 'plugin-vectors.ndjson');
    const inputCopy = join(dir, 'plugins.ndjson');
    copyFileSync(PLUGIN_FIXTURE, inputCopy);
    runEmbed(['--input', inputCopy, '--output', out, '--entity-type', 'plugin']);

    // Mutate every plugin's description → every content_sha drifts → 0% hit.
    const recs = records(inputCopy);
    const header = '{"_header":true,"schema_version":2,"entity_type":"plugin"}\n';
    const body = recs.map((r) => JSON.stringify({ ...r, description: r.description + ' CHANGED entirely now.' })).join('\n') + '\n';
    writeFileSync(inputCopy, header + body, 'utf-8');

    let threw = false;
    try {
      runEmbed(['--input', inputCopy, '--output', out, '--entity-type', 'plugin']);
    } catch (err) {
      threw = true;
      assert.match(String(err.stderr || err.stdout || ''), /DRIFT DETECTED/);
    }
    assert.ok(threw, 'expected drift assertion to exit non-zero');

    // Escape hatch lets it proceed.
    const log = runEmbed(['--input', inputCopy, '--output', out, '--entity-type', 'plugin'], { EMBED_FORCE_REEMBED: '1' });
    assert.match(log, /embedder complete/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
