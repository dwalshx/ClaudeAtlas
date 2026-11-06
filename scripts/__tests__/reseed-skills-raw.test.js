/**
 * scripts/__tests__/reseed-skills-raw.test.js
 *
 * mergeById (pure) + one subprocess round-trip through real NDJSON files
 * (header lines filtered, output header-less, primary wins).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeById } from '../reseed-skills-raw.js';
import { readNdjsonRecords } from '../lib/ndjson.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const SCRIPT = join(ROOT, 'scripts', 'reseed-skills-raw.js');

test('mergeById: union by id, primary wins, counts are right', () => {
  const primary = new Map([['a', { id: 'a', v: 'p' }], ['b', { id: 'b', v: 'p' }]]);
  const secondary = new Map([['b', { id: 'b', v: 's' }], ['c', { id: 'c', v: 's' }]]);
  const { merged, fromPrimary, fromSecondary, collisions } = mergeById(primary, secondary);
  assert.equal(merged.size, 3);
  assert.equal(merged.get('b').v, 'p');
  assert.equal(fromPrimary, 2);
  assert.equal(fromSecondary, 1);
  assert.equal(collisions, 1);
});

test('mergeById with no secondary is the identity', () => {
  const primary = new Map([['a', { id: 'a' }]]);
  const { merged, fromSecondary } = mergeById(primary);
  assert.equal(merged.size, 1);
  assert.equal(fromSecondary, 0);
});

test('subprocess: v2 primary + v1 secondary → header-less merged NDJSON sorted by quality_score', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reseed-'));
  try {
    const primary = join(dir, 'skills-latest.ndjson');
    const secondary = join(dir, 'bootstrap.ndjson');
    const output = join(dir, 'skills-raw.ndjson');
    writeFileSync(primary, [
      '{"_header":true,"schema_version":2,"entity_type":"skill"}',
      '{"id":"o/r/a/SKILL.md","schema_version":2,"entity_type":"skill","quality_score":50,"content_sha":"aaa","extra":{"type":"skill"}}',
      '{"id":"o/r/b/SKILL.md","schema_version":2,"entity_type":"skill","quality_score":90,"content_sha":"bbb","extra":{"type":"skill"}}',
    ].join('\n') + '\n');
    writeFileSync(secondary, [
      '{"id":"o/r/b/SKILL.md","quality_score":10,"content_sha":"old","body_markdown":"x"}',
      '{"id":"o/r/c/SKILL.md","quality_score":70,"content_sha":"ccc","body_markdown":"y"}',
    ].join('\n') + '\n');

    const r = spawnSync('node', [SCRIPT, '--primary', primary, '--secondary', secondary, '--output', output], { encoding: 'utf-8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /3 records \(2 from primary, 1 added from secondary, 1 collisions/);

    const lines = readFileSync(output, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 3, 'no header line in raw output');
    assert.ok(!lines.some((l) => l.includes('"_header"')));
    const ids = lines.map((l) => JSON.parse(l).id);
    assert.deepEqual(ids, ['o/r/b/SKILL.md', 'o/r/c/SKILL.md', 'o/r/a/SKILL.md'], 'quality_score desc');
    const byId = readNdjsonRecords(output, { keyFn: (x) => x.id });
    assert.equal(byId.get('o/r/b/SKILL.md').content_sha, 'bbb', 'primary (v2) record won the collision');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('subprocess: empty primary → exit 1, nothing written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'reseed-empty-'));
  try {
    const primary = join(dir, 'empty.ndjson');
    writeFileSync(primary, '{"_header":true,"schema_version":2,"entity_type":"skill"}\n');
    const output = join(dir, 'out.ndjson');
    const r = spawnSync('node', [SCRIPT, '--primary', primary, '--output', output], { encoding: 'utf-8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /merged corpus is empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
