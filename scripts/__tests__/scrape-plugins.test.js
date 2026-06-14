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
  applyFreshFields,
  shouldRewalk,
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

// ---------------------------------------------------------------------------
// Phase 3.4 Plan 02 (R-3): GraphQL engagement-refresh field mapping.
//
// Change B refreshes known plugin repos' engagement signals via batched
// GraphQL. fetchRepoBatchGraphql returns repo_*-PREFIXED fields; the plugins-raw
// record uses the BARE fetchRepoMetadata shape (stars/forks/open_issues/...).
// applyFreshFields(records, freshByRepo) is the pure mapper that writes the
// repo_* values onto the bare keys IN-PLACE for every record whose
// repo_full_name has a freshByRepo entry. A record with NO entry is left
// untouched (miss = no-op). default_branch uses `?? existing` so a null/undefined
// fresh value keeps the prior branch (graceful staleness).
// ---------------------------------------------------------------------------

test('R-3: applyFreshFields maps repo_* GraphQL fields onto bare plugins-raw keys in-place', () => {
  const records = [
    {
      repo_full_name: 'owner/known',
      stars: 1,
      forks: 1,
      open_issues: 1,
      pushed_at: '2026-01-01T00:00:00Z',
      topics: ['old'],
      archived: false,
      license: 'OLD',
      language: 'OldLang',
      description: 'old desc',
      default_branch: 'master',
      created_at: '2020-01-01T00:00:00Z', // NOT in the refresh set — must survive
    },
  ];
  const freshByRepo = new Map([
    [
      'owner/known',
      {
        repo_stars: 42,
        repo_forks: 7,
        repo_open_issues: 3,
        repo_pushed_at: '2026-06-14T00:00:00Z',
        repo_updated_at: '2026-06-14T00:00:00Z',
        repo_archived: true,
        repo_topics: ['claude', 'plugin'],
        repo_license: 'MIT',
        repo_language: 'TypeScript',
        repo_description: 'fresh desc',
        repo_default_branch: 'main',
      },
    ],
  ]);

  applyFreshFields(records, freshByRepo);

  const r = records[0];
  assert.equal(r.stars, 42, 'repo_stars → stars');
  assert.equal(r.forks, 7, 'repo_forks → forks');
  assert.equal(r.open_issues, 3, 'repo_open_issues → open_issues');
  assert.equal(r.pushed_at, '2026-06-14T00:00:00Z', 'repo_pushed_at → pushed_at');
  assert.deepEqual(r.topics, ['claude', 'plugin'], 'repo_topics → topics');
  assert.equal(r.archived, true, 'repo_archived → archived');
  assert.equal(r.license, 'MIT', 'repo_license → license');
  assert.equal(r.language, 'TypeScript', 'repo_language → language');
  assert.equal(r.description, 'fresh desc', 'repo_description → description');
  assert.equal(r.default_branch, 'main', 'repo_default_branch → default_branch');
  // created_at is NOT in the GraphQL freshness set — must be untouched.
  assert.equal(r.created_at, '2020-01-01T00:00:00Z', 'non-refresh field untouched');
});

test('R-3: applyFreshFields leaves a record with no freshByRepo entry byte-for-byte unchanged (miss = no-op)', () => {
  const original = {
    repo_full_name: 'owner/absent',
    stars: 5,
    forks: 2,
    open_issues: 0,
    pushed_at: '2025-05-05T00:00:00Z',
    topics: ['keep'],
    archived: false,
    license: 'Apache-2.0',
    language: 'Go',
    description: 'unchanged',
    default_branch: 'trunk',
  };
  const records = [{ ...original }];
  // freshByRepo has a DIFFERENT repo — the record's repo is absent.
  const freshByRepo = new Map([
    ['someone/else', { repo_stars: 999, repo_default_branch: 'main' }],
  ]);

  applyFreshFields(records, freshByRepo);

  assert.deepEqual(records[0], original, 'absent record untouched (miss = no-op)');
});

test('R-3: applyFreshFields keeps existing default_branch when fresh value is null/undefined', () => {
  const records = [
    { repo_full_name: 'owner/repo', default_branch: 'develop', stars: 1 },
  ];
  const freshByRepo = new Map([
    [
      'owner/repo',
      {
        repo_stars: 10,
        repo_default_branch: null, // null fresh branch → keep existing
      },
    ],
  ]);

  applyFreshFields(records, freshByRepo);

  assert.equal(records[0].stars, 10, 'other fields still refreshed');
  assert.equal(
    records[0].default_branch,
    'develop',
    'null fresh default_branch keeps the existing branch (?? existing)',
  );
});

// ---------------------------------------------------------------------------
// Phase 3.4 Plan 03 (R-4): the pushed_at re-walk completeness gate.
//
// Change C (RESEARCH §C / Code Examples §3): skip-fix (Plan 01) + refresh
// (Plan 02) still won't catch a KNOWN repo that ADDS a component (new skill/
// command/agent/MCP) — no new repo ID, so the bare processedSet skip misses it.
// shouldRewalk(known, freshPushedAt, opts) is the repo-level change gate: a
// known repo whose FRESH pushed_at (from Plan 02's GraphQL refresh) advanced
// past its stored walked_pushed_at is re-walked; an unchanged known repo keeps
// its cached components for free. This mirrors Track 2's blob-sha skip intent at
// repo granularity (scrape-discover-repos.js).
//
// shouldRewalk is ONLY consulted for KNOWN repos — a brand-new repo (not in the
// skip set) is handled by the caller and never reaches this helper.
// ---------------------------------------------------------------------------

test('R-4: shouldRewalk returns TRUE when freshPushedAt is newer than walked_pushed_at', () => {
  const known = { repo_full_name: 'owner/repo', walked_pushed_at: '2026-01-01T00:00:00Z' };
  // A component may have been added since the last walk → re-walk.
  assert.equal(
    shouldRewalk(known, '2026-06-14T00:00:00Z'),
    true,
    'newer fresh pushed_at → re-walk',
  );
});

test('R-4: shouldRewalk returns FALSE when freshPushedAt is older-or-equal to walked_pushed_at', () => {
  const known = { repo_full_name: 'owner/repo', walked_pushed_at: '2026-06-14T00:00:00Z' };
  assert.equal(
    shouldRewalk(known, '2026-06-14T00:00:00Z'),
    false,
    'equal pushed_at (unchanged) → keep cached, no re-walk',
  );
  assert.equal(
    shouldRewalk(known, '2026-01-01T00:00:00Z'),
    false,
    'older fresh pushed_at → keep cached, no re-walk',
  );
});

test('R-4: shouldRewalk returns TRUE when walked_pushed_at is missing/null (never stamped → backfill)', () => {
  // A record walked before the stamp existed has no walked_pushed_at — re-walk
  // it once to backfill the stamp so future runs can gate correctly.
  assert.equal(
    shouldRewalk({ repo_full_name: 'a/b' }, '2026-06-14T00:00:00Z'),
    true,
    'undefined walked_pushed_at → re-walk to backfill',
  );
  assert.equal(
    shouldRewalk({ repo_full_name: 'a/b', walked_pushed_at: null }, '2026-06-14T00:00:00Z'),
    true,
    'null walked_pushed_at → re-walk to backfill',
  );
});

test('R-4: shouldRewalk returns FALSE when stamped but freshPushedAt is missing (no fresh signal → keep cached)', () => {
  // A refresh casualty (GraphQL couldn't resolve the repo) yields no fresh
  // pushed_at. With a valid prior stamp, there's no signal to re-walk → keep
  // the cached components rather than re-walking on every run.
  const known = { repo_full_name: 'owner/repo', walked_pushed_at: '2026-01-01T00:00:00Z' };
  assert.equal(shouldRewalk(known, undefined), false, 'undefined fresh + stamped → keep cached');
  assert.equal(shouldRewalk(known, null), false, 'null fresh + stamped → keep cached');
});

test('R-4: shouldRewalk returns TRUE when opts.periodicFull is set, regardless of timestamps (safety-net shard)', () => {
  // The weekly full re-walk safety net forces a re-walk even when pushed_at
  // would otherwise gate it out (belt-and-suspenders for a repo whose pushed_at
  // somehow didn't advance but components did).
  const fresh = { repo_full_name: 'owner/repo', walked_pushed_at: '2026-06-14T00:00:00Z' };
  assert.equal(
    shouldRewalk(fresh, '2026-06-14T00:00:00Z', { periodicFull: true }),
    true,
    'periodicFull overrides an otherwise-unchanged (equal) repo',
  );
  assert.equal(
    shouldRewalk(fresh, '2026-01-01T00:00:00Z', { periodicFull: true }),
    true,
    'periodicFull overrides an otherwise-older repo',
  );
  // periodicFull even forces a walk when there is no fresh signal at all.
  assert.equal(
    shouldRewalk(fresh, undefined, { periodicFull: true }),
    true,
    'periodicFull overrides a missing fresh signal',
  );
});
