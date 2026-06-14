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
import {
  loadCheckpointFrom,
  saveCheckpointTo,
  buildProcessedSeedFrom,
} from '../scrape-plugins.js';
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

// ---------------------------------------------------------------------------
// Phase 3.4 Plan 01 (R-2): the cross-run skip-wiring fix.
//
// THE BUG (RESEARCH §A / Pitfall 1): loadCheckpoint() seeded processedSet from
// PARTIAL_PATH (data/plugins-raw.ndjson.partial), but the GHA cache + bootstrap
// release only persist the OUTPUT data/plugins-raw.ndjson. The .partial never
// survives between runs, so processedSet started EMPTY every run, the skip never
// fired, and all ~7,300 repos were re-walked from cold (~24h → timeout). The
// restored OUTPUT corpus was silently ignored.
//
// buildProcessedSeedFrom(outputPath, partialPath) is the fix: seed from OUTPUT
// (the cached, completed corpus), merging .partial for same-job resume with
// .partial winning per-repo (fresher). processedSet = union of both files' names.
// ---------------------------------------------------------------------------

test('R-2: buildProcessedSeedFrom seeds processedSet from the cached OUTPUT (size === N)', () => {
  const dir = tmpPartialDir();
  const output = join(dir, 'plugins-raw.ndjson');
  const partial = join(dir, 'plugins-raw.ndjson.partial'); // absent
  try {
    const records = [
      { repo_full_name: 'a/one', stars: 1 },
      { repo_full_name: 'b/two', stars: 2 },
      { repo_full_name: 'c/three', stars: 3 },
    ];
    saveCheckpointTo(output, records);

    const { repos, processedSet } = buildProcessedSeedFrom(output, partial);

    // The bug-catching assertion: without the OUTPUT-aware seed, processedSet
    // would be empty (size 0) because only .partial was read.
    assert.equal(processedSet.size, records.length, 'processedSet seeded from OUTPUT');
    assert.equal(repos.length, records.length, 'all OUTPUT records returned');
    assert.deepEqual(
      processedSet,
      new Set(['a/one', 'b/two', 'c/three']),
      'every OUTPUT repo name present in processedSet',
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-2: buildProcessedSeedFrom merges OUTPUT + .partial, .partial wins on conflict', () => {
  const dir = tmpPartialDir();
  const output = join(dir, 'plugins-raw.ndjson');
  const partial = join(dir, 'plugins-raw.ndjson.partial');
  try {
    // OUTPUT = the completed corpus from prior runs.
    saveCheckpointTo(output, [
      { repo_full_name: 'shared/repo', stars: 10, source: 'output' },
      { repo_full_name: 'output/only', stars: 1, source: 'output' },
    ]);
    // .partial = a same-job mid-run checkpoint with a fresher 'shared/repo'
    // payload plus a brand-new repo not yet in OUTPUT.
    saveCheckpointTo(partial, [
      { repo_full_name: 'shared/repo', stars: 99, source: 'partial' },
      { repo_full_name: 'partial/only', stars: 2, source: 'partial' },
    ]);

    const { repos, processedSet } = buildProcessedSeedFrom(output, partial);

    // processedSet = union of both files' names.
    assert.deepEqual(
      processedSet,
      new Set(['shared/repo', 'output/only', 'partial/only']),
      'processedSet is the union of OUTPUT and .partial repo names',
    );
    assert.equal(repos.length, 3, 'one record per unique repo name');

    // .partial wins (newer) on the conflicting repo.
    const byName = new Map(repos.map((r) => [r.repo_full_name, r]));
    assert.equal(byName.get('shared/repo').stars, 99, '.partial payload wins on conflict');
    assert.equal(byName.get('shared/repo').source, 'partial', '.partial record is the merged one');
    assert.equal(byName.get('output/only').source, 'output', 'OUTPUT-only record preserved');
    assert.equal(byName.get('partial/only').source, 'partial', '.partial-only record included');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-2: buildProcessedSeedFrom with OUTPUT present + .partial absent seeds the full set (warm-run case)', () => {
  const dir = tmpPartialDir();
  const output = join(dir, 'plugins-raw.ndjson');
  const partial = join(dir, 'does-not-exist.ndjson.partial'); // the warm-run reality
  try {
    const records = [
      { repo_full_name: 'warm/a' },
      { repo_full_name: 'warm/b' },
      { repo_full_name: 'warm/c' },
      { repo_full_name: 'warm/d' },
    ];
    saveCheckpointTo(output, records);

    const { repos, processedSet } = buildProcessedSeedFrom(output, partial);

    // This is exactly the case the bug broke: cached OUTPUT restored, no
    // .partial. The full corpus must still seed processedSet.
    assert.equal(processedSet.size, records.length, 'warm OUTPUT fully seeds processedSet');
    assert.equal(repos.length, records.length, 'all warm OUTPUT records returned');
    assert.deepEqual(processedSet, new Set(['warm/a', 'warm/b', 'warm/c', 'warm/d']));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
