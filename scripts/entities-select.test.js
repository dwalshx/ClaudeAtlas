/**
 * scripts/entities-select.test.js
 *
 * Quick task 260804-eh7 — per-repo diversity cap on homepage selection.
 *
 * Covers the SELECTION-ONLY helpers added to src/lib/entities.js:
 *   - capPerRepo(entities, maxPerRepo): pure per-repo diversity cap
 *   - getFeaturedSkills(limit, maxPerRepo): featured strip selection
 *
 * The test is self-contained: it writes a tiny NDJSON fixture to a temp path
 * and points SKILLS_NDJSON_OVERRIDE at it BEFORE importing entities.js (whose
 * data load happens at module-eval time). No dependency on data/skills.ndjson.
 *
 * Run: node --test scripts/entities-select.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --- Build a controlled fixture and wire the override BEFORE importing ---
const dir = mkdtempSync(join(tmpdir(), 'eh7-select-'));
const fixturePath = join(dir, 'skills.ndjson');

// v1-flat skill records (upcaster in entities.js stamps entity_type='skill').
// featured repoA appears twice (cap target); one featured record is a
// duplicate (must be excluded); one solid record (wrong tier, excluded).
const records = [
  { id: 'f-a1', slug: 'a/one',   repo_full_name: 'owner/repoA', repo_stars: 100, quality_score: 99, quality_tier: 'featured' },
  { id: 'f-a2', slug: 'a/two',   repo_full_name: 'owner/repoA', repo_stars: 90,  quality_score: 98, quality_tier: 'featured' },
  { id: 'f-b1', slug: 'b/one',   repo_full_name: 'owner/repoB', repo_stars: 80,  quality_score: 97, quality_tier: 'featured' },
  { id: 'f-c1', slug: 'c/one',   repo_full_name: 'owner/repoC', repo_stars: 70,  quality_score: 96, quality_tier: 'featured' },
  { id: 'f-d1', slug: 'd/one',   repo_full_name: 'owner/repoD', repo_stars: 60,  quality_score: 95, quality_tier: 'featured', is_duplicate: true },
  { id: 's-e1', slug: 'e/one',   repo_full_name: 'owner/repoE', repo_stars: 50,  quality_score: 80, quality_tier: 'solid' },
];

const lines = [JSON.stringify({ _header: true, schema_version: 2, entity_type: 'skill' })]
  .concat(records.map((r) => JSON.stringify(r)));
writeFileSync(fixturePath, lines.join('\n') + '\n');

process.env.SKILLS_NDJSON_OVERRIDE = fixturePath;

// Dynamic import so the override env is set before entities.js evaluates.
const { capPerRepo, getFeaturedSkills } = await import('../src/lib/entities.js');

// ---------------------------------------------------------------------------
// capPerRepo — pure function
// ---------------------------------------------------------------------------

test('capPerRepo enforces the per-repo cap and preserves order', () => {
  const input = [
    { id: '1', repo_full_name: 'a' },
    { id: '2', repo_full_name: 'a' },
    { id: '3', repo_full_name: 'a' },
    { id: '4', repo_full_name: 'b' },
    { id: '5', repo_full_name: 'b' },
  ];
  assert.deepEqual(capPerRepo(input, 1).map((x) => x.id), ['1', '4']);
  assert.deepEqual(capPerRepo(input, 2).map((x) => x.id), ['1', '2', '4', '5']);
  // Cap above supply is a no-op (keeps everything, order preserved).
  assert.deepEqual(capPerRepo(input, 9).map((x) => x.id), ['1', '2', '3', '4', '5']);
});

test('capPerRepo keeps entities without a repo identity', () => {
  const input = [
    { id: '1', repo_full_name: 'a' },
    { id: '2', repo_full_name: 'a' },
    { id: '3' }, // no repo_full_name
    { id: '4', repo_full_name: '' }, // empty repo
  ];
  assert.deepEqual(capPerRepo(input, 1).map((x) => x.id), ['1', '3', '4']);
});

test('capPerRepo treats non-positive / non-finite caps as pass-through', () => {
  const input = [
    { id: '1', repo_full_name: 'a' },
    { id: '2', repo_full_name: 'a' },
  ];
  assert.deepEqual(capPerRepo(input, 0).map((x) => x.id), ['1', '2']);
  assert.deepEqual(capPerRepo(input, -1).map((x) => x.id), ['1', '2']);
  assert.deepEqual(capPerRepo(input, NaN).map((x) => x.id), ['1', '2']);
  // Returns a COPY, not the same reference.
  assert.notEqual(capPerRepo(input, 0), input);
});

test('capPerRepo returns [] for non-array input', () => {
  assert.deepEqual(capPerRepo(null), []);
  assert.deepEqual(capPerRepo(undefined), []);
  assert.deepEqual(capPerRepo('nope'), []);
});

// ---------------------------------------------------------------------------
// getFeaturedSkills — selection against the fixture
// ---------------------------------------------------------------------------

test('getFeaturedSkills defaults to one card per repo, excludes dups + non-featured', () => {
  const featured = getFeaturedSkills(6); // default maxPerRepo=1
  const ids = featured.map((s) => s.id);
  // repoA capped to one (f-a1, not f-a2); f-d1 excluded (is_duplicate); solid excluded.
  assert.deepEqual(ids, ['f-a1', 'f-b1', 'f-c1']);
  // All distinct repos.
  const repos = featured.map((s) => s.repo_full_name);
  assert.equal(new Set(repos).size, repos.length);
});

test('getFeaturedSkills honors an explicit higher per-repo cap', () => {
  const featured = getFeaturedSkills(6, 2);
  // repoA now allowed twice; still excludes the duplicate and the solid record.
  assert.deepEqual(featured.map((s) => s.id), ['f-a1', 'f-a2', 'f-b1', 'f-c1']);
});

test('getFeaturedSkills respects the limit after capping', () => {
  const featured = getFeaturedSkills(2); // maxPerRepo=1
  assert.deepEqual(featured.map((s) => s.id), ['f-a1', 'f-b1']);
});

test('getFeaturedSkills returns results sorted by quality_score desc', () => {
  const featured = getFeaturedSkills(6, 2);
  const scores = featured.map((s) => s.quality_score);
  const sorted = [...scores].sort((a, b) => b - a);
  assert.deepEqual(scores, sorted);
});
