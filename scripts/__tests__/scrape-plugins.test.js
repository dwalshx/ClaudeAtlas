/**
 * scripts/__tests__/scrape-plugins.test.js
 *
 * Phase 3.3 Wave 0 (D-02). Regression coverage for the loadCheckpoint()
 * latent format bug: saveCheckpoint writes the .partial as NDJSON
 * (array-of-records via writeNdjsonStreaming) but the pre-3.3
 * loadCheckpoint read it as a JSON object with a `.repos` key — the
 * try/catch swallowed the mismatch and returned an empty processedSet,
 * so checkpoint resume NEVER worked (every run re-processed the corpus).
 *
 * These tests pin the NDJSON round-trip contract via the path-injectable
 * variants loadCheckpointFrom(path) / saveCheckpointTo(path, repos).
 *
 * NOTE: importing ../scrape-plugins.js must be side-effect free — no
 * GITHUB_TOKEN required, no main() auto-run (invoked-as-script guard).
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadCheckpointFrom, saveCheckpointTo } from '../scrape-plugins.js';
import { writeNdjsonStreaming } from '../lib/ndjson.js';

function tmpPartialDir() {
  return mkdtempSync(join(tmpdir(), 'scrape-plugins-test-'));
}

test('loadCheckpointFrom round-trips an NDJSON .partial written by writeNdjsonStreaming', () => {
  const dir = tmpPartialDir();
  const partial = join(dir, 'plugins-raw.ndjson.partial');
  try {
    writeNdjsonStreaming(partial, [
      { repo_full_name: 'a/b', stars: 5 },
      { repo_full_name: 'c/d', stars: 9 },
    ]);

    const { repos, processedSet } = loadCheckpointFrom(partial);
    assert.equal(repos.length, 2, 'recovers both records');
    assert.deepEqual(processedSet, new Set(['a/b', 'c/d']), 'processedSet recovered');
    const byName = new Map(repos.map((r) => [r.repo_full_name, r]));
    assert.equal(byName.get('a/b').stars, 5, 'record payload intact');
    assert.equal(byName.get('c/d').stars, 9, 'record payload intact');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadCheckpointFrom on a missing path returns empty repos + empty processedSet', () => {
  const dir = tmpPartialDir();
  try {
    const { repos, processedSet } = loadCheckpointFrom(join(dir, 'does-not-exist.partial'));
    assert.deepEqual(repos, []);
    assert.ok(processedSet instanceof Set);
    assert.equal(processedSet.size, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('REGRESSION (D-02): a .partial written by saveCheckpointTo is readable by loadCheckpointFrom', () => {
  // The latent bug: saveCheckpoint wrote NDJSON, loadCheckpoint read a JSON
  // object's `.repos` key. This round-trip through the scraper's OWN
  // save/load pair proves resume now actually works.
  const dir = tmpPartialDir();
  const partial = join(dir, 'plugins-raw.ndjson.partial');
  try {
    const repos = [
      { repo_full_name: 'owner/plugin-one', plugin_manifest: { name: 'one' } },
      { repo_full_name: 'owner/plugin-two', plugin_manifest: { name: 'two' } },
      { repo_full_name: 'other/market', marketplace_manifest: { name: 'market-kit' } },
    ];
    saveCheckpointTo(partial, repos);

    const recovered = loadCheckpointFrom(partial);
    assert.equal(recovered.repos.length, 3);
    assert.deepEqual(
      recovered.processedSet,
      new Set(['owner/plugin-one', 'owner/plugin-two', 'other/market']),
      'processedSet incremental skip recovers all processed repo names',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadCheckpointFrom tolerates a truncated final line (crash-mid-write resume)', () => {
  const dir = tmpPartialDir();
  const partial = join(dir, 'plugins-raw.ndjson.partial');
  try {
    writeNdjsonStreaming(partial, [{ repo_full_name: 'a/b' }]);
    // Simulate a crash mid-append: add a truncated JSON line.
    appendFileSync(partial, '{"repo_full_name":"c/');

    const { repos, processedSet } = loadCheckpointFrom(partial);
    assert.equal(repos.length, 1, 'complete lines survive, truncated line skipped');
    assert.deepEqual(processedSet, new Set(['a/b']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
