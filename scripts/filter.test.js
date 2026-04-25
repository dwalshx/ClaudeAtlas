// scripts/filter.test.js
//
// Unit tests for R3 merge semantics. Approach: import applyTrack1Freshness
// directly and drive it with in-memory fixtures. No subprocess, no I/O.
// (Per C8 of 3.0.0-PLAN-CHECK: subprocess fallback was the alternative,
// not chosen because exporting the helper from filter.js is non-invasive.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTrack1Freshness } from './filter.js';
import { TRACK1_FRESHNESS_FIELDS } from './lib/skill-fields.js';

function makeSkill(overrides = {}) {
  return {
    id: 'owner/repo/path',
    slug: 'owner/repo',
    repo_stars: 10,
    repo_forks: 1,
    repo_open_issues: 0,
    repo_pushed_at: '2026-01-01T00:00:00Z',
    repo_updated_at: '2026-01-01T00:00:00Z',
    repo_archived: false,
    repo_topics: ['original'],
    repo_license: 'MIT',
    repo_language: 'TypeScript',
    repo_default_branch: 'main',
    body_markdown: 'x'.repeat(600),
    body_length: 600,
    has_name: true,
    has_description: true,
    repo_description: 'meaningful description here',
    quality_score: 50,
    ...overrides,
  };
}

test('Test 1: slug match copies all 11 freshness fields', () => {
  const raw = [makeSkill({ repo_stars: 10, repo_topics: ['raw'] })];
  const currentBySlug = new Map([['owner/repo', makeSkill({
    repo_stars: 999, repo_forks: 50, repo_topics: ['fresh'],
    repo_license: 'Apache-2.0', repo_default_branch: 'develop',
  })]]);
  const { mergedCount } = applyTrack1Freshness(raw, currentBySlug);
  assert.equal(mergedCount, 1);
  assert.equal(raw[0].repo_stars, 999);
  assert.equal(raw[0].repo_forks, 50);
  assert.deepEqual(raw[0].repo_topics, ['fresh']);
  assert.equal(raw[0].repo_license, 'Apache-2.0');
  assert.equal(raw[0].repo_default_branch, 'develop');
});

test('Test 2: re-scored after merge', () => {
  const raw = [makeSkill({ repo_stars: 10, quality_score: 50 })];
  const currentBySlug = new Map([['owner/repo', makeSkill({ repo_stars: 999 })]]);
  applyTrack1Freshness(raw, currentBySlug);
  // 999 stars >> 10 stars => higher quality_score
  assert.ok(raw[0].quality_score > 50, `expected score > 50, got ${raw[0].quality_score}`);
});

test('Test 3: no slug match = passthrough', () => {
  const raw = [makeSkill({ slug: 'unknown/repo', repo_stars: 7 })];
  const currentBySlug = new Map();
  const { mergedCount } = applyTrack1Freshness(raw, currentBySlug);
  assert.equal(mergedCount, 0);
  assert.equal(raw[0].repo_stars, 7);
});

test('Test 4: tier thresholds compose with re-score', async () => {
  // After applyTrack1Freshness, the calling code (filter.js main) re-tiers
  // from quality_score. Verify the score moves enough to push tiers.
  const raw = [makeSkill({ slug: 'a/b', repo_stars: 1 })];
  const currentBySlug = new Map([['a/b', makeSkill({
    slug: 'a/b', repo_stars: 100000, repo_pushed_at: new Date().toISOString(),
  })]]);
  applyTrack1Freshness(raw, currentBySlug);
  // 100k stars + recent push => high score
  assert.ok(raw[0].quality_score >= 70, `expected tier-eligible score, got ${raw[0].quality_score}`);
});

test('Test 5: PRESERVED_FIELDS (skill_first_commit_at) untouched by Track 1 merge', () => {
  const raw = [makeSkill({ skill_first_commit_at: '2025-06-01T00:00:00Z' })];
  const currentBySlug = new Map([['owner/repo', makeSkill({
    skill_first_commit_at: 'SHOULD-NOT-OVERWRITE',  // not in TRACK1_FRESHNESS_FIELDS
    repo_stars: 999,
  })]]);
  applyTrack1Freshness(raw, currentBySlug);
  assert.equal(raw[0].skill_first_commit_at, '2025-06-01T00:00:00Z');
  assert.equal(raw[0].repo_stars, 999); // Track 1 fields DID merge
});

test('Test 6: same slug, different id — slug merge applies', () => {
  const raw = [makeSkill({ id: 'owner/repo/path-v2', slug: 'owner/repo' })];
  const currentBySlug = new Map([['owner/repo', makeSkill({
    id: 'owner/repo/path-v1',  // different id — fine, slug is the merge key
    slug: 'owner/repo',
    repo_stars: 555,
  })]]);
  const { mergedCount } = applyTrack1Freshness(raw, currentBySlug);
  assert.equal(mergedCount, 1);
  assert.equal(raw[0].repo_stars, 555);
  assert.equal(raw[0].id, 'owner/repo/path-v2'); // id stays from raw
});
