/**
 * scripts/__tests__/embed-skills-empty-input.test.js
 *
 * Subprocess (EMBED_DRY_RUN=1) regression test for the outage 2026-10-18 →
 * 11-03 path: embed-skills.js received a 0-record skills.ndjson, wrote a
 * 0-vector file and exited 0. It must now exit 1 and leave no output file
 * behind, unless EMBED_ALLOW_EMPTY=1 is set explicitly (fixtures).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const EMBED = join(ROOT, 'scripts', 'embed-skills.js');

function runEmbed(args, env = {}) {
  return spawnSync('node', [EMBED, ...args], {
    cwd: ROOT,
    env: { ...process.env, EMBED_DRY_RUN: '1', ...env },
    encoding: 'utf-8',
  });
}

test('0-record input → exit 1, no output file written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-empty-'));
  try {
    const input = join(dir, 'plugins.ndjson');
    writeFileSync(input, '{"_header":true,"schema_version":2,"entity_type":"plugin"}\n', 'utf-8');
    const out = join(dir, 'plugin-vectors.ndjson');
    const r = runEmbed(['--input', input, '--output', out, '--entity-type', 'plugin']);
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /\[embed\] FATAL: embed input has 0 records/);
    assert.equal(existsSync(out), false, 'must not write an empty vector file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('0-record input with EMBED_ALLOW_EMPTY=1 → exit 0 (fixture escape hatch)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-empty-ok-'));
  try {
    const input = join(dir, 'plugins.ndjson');
    writeFileSync(input, '{"_header":true,"schema_version":2,"entity_type":"plugin"}\n', 'utf-8');
    const out = join(dir, 'plugin-vectors.ndjson');
    const r = runEmbed(['--input', input, '--output', out, '--entity-type', 'plugin'], { EMBED_ALLOW_EMPTY: '1' });
    assert.equal(r.status, 0, `expected exit 0, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.equal(existsSync(out), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('records with no id → exit 1 (input present, output would be empty)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'embed-noid-'));
  try {
    const input = join(dir, 'plugins.ndjson');
    writeFileSync(input, [
      '{"_header":true,"schema_version":2,"entity_type":"plugin"}',
      '{"slug":"a/b","name":"no-id","description":"x","entity_type":"plugin"}',
    ].join('\n') + '\n', 'utf-8');
    const out = join(dir, 'plugin-vectors.ndjson');
    const r = runEmbed(['--input', input, '--output', out, '--entity-type', 'plugin']);
    // readNdjsonRecords keys by r.id; an id-less record collapses to one
    // `undefined` key and is then skipped by `if (!rec.id) continue`.
    assert.equal(r.status, 1, `expected exit 1, got ${r.status}\n${r.stdout}\n${r.stderr}`);
    assert.match(r.stderr, /\[embed\] FATAL/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
