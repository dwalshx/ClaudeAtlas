/**
 * scripts/__tests__/embed-skills.test.js
 *
 * Phase 3.2 Task 9. embed-skills.js as the unified embedder for all three
 * entity_types. Subprocess-driven (EMBED_DRY_RUN=1) so no OpenAI calls.
 * Covers: deterministic plugin + mcp vectors, metadata.entity_type, the B-2
 * cache-hit pre-check (100% prior-overlap on re-run) and the drift-guard
 * bail-out / proceed cases under the quick-260804-dy2 prior-overlap rule.
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
import { MIN_PRIOR_FOR_DRIFT_CHECK } from '../embed-skills.js';

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

// --- B-2 drift guard (subprocess, end-to-end) ---
//
// quick-260804-dy2 (FIX A) re-based the drift decision on PRIOR-OVERLAP:
//   bail  iff  matchedFromPrior / priorCount < PRIOR_MATCH_BAIL_THRESHOLD (0.5)
//         AND  priorCount >= MIN_PRIOR_FOR_DRIFT_CHECK (50)
// The pure helper (shouldBailOnDrift) is unit-tested in scripts/embed-skills.test.js.
// The tests below prove the END-TO-END wiring in main(): partition -> log line ->
// bail/proceed -> output write. They are subprocess-driven on purpose; a pure
// test could not observe the exit code or the rewritten vector file.
//
// The 3-record plugins-mini fixture sits BELOW the 50-prior floor, so the drift
// cases build a synthetic input of DRIFT_N records cloned from it.

const DRIFT_N = MIN_PRIOR_FOR_DRIFT_CHECK + 10;
const PLUGIN_HEADER = '{"_header":true,"schema_version":2,"entity_type":"plugin"}\n';

// Write a plugin NDJSON of `n` records cloned from the fixture with unique
// id/slug/name, applying `mutate` to each clone. Returns the records written.
function writeSyntheticPlugins(path, n, mutate = (r) => r) {
  const base = records(PLUGIN_FIXTURE);
  const out = [];
  for (let i = 0; i < n; i++) {
    const src = base[i % base.length];
    out.push(mutate({
      ...src,
      id: `plugin:synth/p${i}/.claude-plugin/plugin.json`,
      slug: `synth/p${i}`,
      name: `${src.name}-${i}`,
    }, i));
  }
  writeFileSync(path, PLUGIN_HEADER + out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
  return out;
}

// Pull the integer out of a `[embed] <label>: <n>` log line.
function parseCount(log, re) {
  const m = log.match(re);
  assert.ok(m, `log line matching ${re} must be present`);
  return Number(m[1]);
}

function expectDriftBail(args) {
  let threw = false;
  try {
    runEmbed(args);
  } catch (err) {
    threw = true;
    assert.notEqual(err.status, 0, 'drift bail must exit non-zero');
    assert.match(String(err.stderr || ''), /DRIFT DETECTED/);
  }
  assert.ok(threw, 'expected drift assertion to exit non-zero');
}

test('Task 9: B-2 cache-hit pre-check — 100% prior-overlap, nothing to embed on unchanged re-run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-cache-'));
  try {
    const out = join(dir, 'plugin-vectors.ndjson');
    runEmbed(['--input', PLUGIN_FIXTURE, '--output', out, '--entity-type', 'plugin']);
    const first = records(out);
    // Re-run against the SAME input + existing vectors -> every prior vector is
    // reused, nothing is sent to the embedder, output is rewritten unchanged.
    const log = runEmbed(['--input', PLUGIN_FIXTURE, '--output', out, '--entity-type', 'plugin']);
    assert.match(log, /prior vectors: 3/);
    assert.match(log, /unchanged: 3/);
    assert.match(log, /to embed:\s+0/);
    assert.match(log, /prior-overlap: 100\.00% of prior vectors still match \(3\/3 prior; 3\/3 current kept\)/);
    assert.match(log, /no changes — writing output unchanged/);
    assert.doesNotMatch(log, /DRIFT DETECTED/);
    const second = records(out);
    assert.equal(second.length, first.length);
    assert.deepEqual(second.map((r) => r.values), first.map((r) => r.values));
    assert.deepEqual(second.map((r) => r.metadata._content_sha), first.map((r) => r.metadata._content_sha));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Task 9: B-2 drift guard bails on majority prior-miss above the floor; EMBED_FORCE_REEMBED overrides', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-drift-'));
  try {
    const out = join(dir, 'plugin-vectors.ndjson');
    const input = join(dir, 'plugins.ndjson');
    writeSyntheticPlugins(input, DRIFT_N);
    const seed = runEmbed(['--input', input, '--output', out, '--entity-type', 'plugin']);
    assert.match(seed, /prior vectors: 0/);
    assert.equal(records(out).length, DRIFT_N);

    // Mutate every description -> every plugin content_sha drifts -> 0/DRIFT_N of
    // the prior vectors still match. DRIFT_N >= MIN_PRIOR floor -> BAIL.
    writeSyntheticPlugins(input, DRIFT_N, (r) => ({ ...r, description: r.description + ' CHANGED entirely now.' }));
    expectDriftBail(['--input', input, '--output', out, '--entity-type', 'plugin']);
    // The bail must leave the prior vector file untouched.
    assert.equal(records(out).length, DRIFT_N);

    // Escape hatch lets it proceed and re-embeds the whole set.
    const forced = runEmbed(['--input', input, '--output', out, '--entity-type', 'plugin'], { EMBED_FORCE_REEMBED: '1' });
    assert.match(forced, /prior-overlap: 0\.00%/);
    assert.equal(parseCount(forced, /to embed:\s+(\d+)/), DRIFT_N);
    assert.match(forced, /embedder complete/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Task 9: B-2 drift guard PROCEEDS on catalog growth and on a below-floor prior set (dy2 FIX A)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-nodrift-'));
  try {
    // (a) GROWTH: the DRIFT_N prior records are unchanged, 200 brand-new ones
    // arrive. The retired overall-hit-rate rule saw 60/260 = 23% and WRONGLY
    // bailed; prior-overlap is 100% -> proceed, embedding only the new records.
    const out = join(dir, 'plugin-vectors.ndjson');
    const input = join(dir, 'plugins.ndjson');
    writeSyntheticPlugins(input, DRIFT_N);
    runEmbed(['--input', input, '--output', out, '--entity-type', 'plugin']);
    const GROWN = DRIFT_N + 200;
    writeSyntheticPlugins(input, GROWN);
    const grow = runEmbed(['--input', input, '--output', out, '--entity-type', 'plugin']);
    const overlap = grow.match(/prior-overlap: ([\d.]+)% of prior vectors still match \((\d+)\/(\d+) prior; (\d+)\/(\d+) current kept\)/);
    assert.ok(overlap, 'prior-overlap log line must be present');
    assert.deepEqual(overlap.slice(1).map(Number), [100, DRIFT_N, DRIFT_N, DRIFT_N, GROWN]);
    assert.match(grow, /to embed:\s+200\b/);
    assert.match(grow, /embedder complete/);
    assert.equal(records(out).length, GROWN);

    // (b) BELOW-FLOOR: the 3-record fixture, fully mutated. Pre-dy2 this bailed
    // (0% hit); a 3-vector prior set is an evicted/bootstrap remnant and must
    // simply re-embed.
    const out2 = join(dir, 'mini-vectors.ndjson');
    const input2 = join(dir, 'mini.ndjson');
    copyFileSync(PLUGIN_FIXTURE, input2);
    runEmbed(['--input', input2, '--output', out2, '--entity-type', 'plugin']);
    const mutated = records(input2).map((r) => ({ ...r, description: r.description + ' CHANGED entirely now.' }));
    writeFileSync(input2, PLUGIN_HEADER + mutated.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf-8');
    const small = runEmbed(['--input', input2, '--output', out2, '--entity-type', 'plugin']);
    assert.match(small, /prior-overlap: 0\.00%/);
    assert.match(small, /to embed:\s+3\b/);
    assert.match(small, /embedder complete/);
    assert.doesNotMatch(small, /DRIFT DETECTED/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
