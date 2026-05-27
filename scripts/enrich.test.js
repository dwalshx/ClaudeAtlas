import { test } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { enrichSkills, compareForCanonical } from './enrich.js';

// Helper: synthesize a normalized vector with hot slots.
function vec(dim, hot) {
  const v = new Array(dim).fill(0);
  if (Array.isArray(hot)) {
    for (const { slot, value } of hot) v[slot] = value;
  } else {
    v[hot.slot] = 1;
  }
  return v;
}

// Mirror of vectorizeId() for test-side derivation of expected IDs.
function expectedVid(skillId) {
  if (skillId.length <= 64) {
    return skillId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
  }
  return 'sk_' + createHash('sha256').update(skillId).digest('hex').slice(0, 40);
}

test('enrich: two skills with cosine ~1.0 → older is canonical, younger is duplicate', () => {
  const skills = [
    {
      id: 'alice/repo1/SKILL.md', slug: 'alice/foo',
      skill_first_commit_at: '2024-01-01T00:00:00Z',
      repo_created_at: '2024-01-01T00:00:00Z',
      repo_pushed_at: '2026-01-01T00:00:00Z',
    },
    {
      id: 'bob/repo2/SKILL.md', slug: 'bob/foo',
      skill_first_commit_at: '2025-06-01T00:00:00Z',
      repo_created_at: '2025-01-01T00:00:00Z',
      repo_pushed_at: '2026-04-01T00:00:00Z',
    },
  ];
  const vectors = [
    { id: expectedVid(skills[0].id), values: vec(8, { slot: 0 }) },
    { id: expectedVid(skills[1].id), values: vec(8, { slot: 0 }) },
  ];
  enrichSkills(skills, vectors);
  assert.equal(skills[0].is_duplicate, false);
  assert.equal(skills[0].canonical_slug, null);
  assert.equal(skills[1].is_duplicate, true);
  assert.equal(skills[1].canonical_slug, 'alice/foo');
});

test('enrich: cosine < 0.92 → both is_duplicate=false, novelty ~1', () => {
  const skills = [
    { id: 'a/b/SKILL.md', slug: 'a/foo', repo_created_at: '2024-01-01T00:00:00Z' },
    { id: 'c/d/SKILL.md', slug: 'c/bar', repo_created_at: '2024-01-01T00:00:00Z' },
  ];
  const vectors = [
    { id: expectedVid(skills[0].id), values: vec(8, { slot: 0 }) },
    { id: expectedVid(skills[1].id), values: vec(8, { slot: 1 }) },
  ];
  enrichSkills(skills, vectors);
  assert.equal(skills[0].is_duplicate, false);
  assert.equal(skills[1].is_duplicate, false);
  assert.equal(skills[0].novelty_score, 1);
  assert.equal(skills[1].novelty_score, 1);
});

test('enrich: missing skill_first_commit_at falls back to repo_created_at', () => {
  const a = { slug: 'a/x', repo_created_at: '2024-01-01T00:00:00Z' };
  const b = { slug: 'b/x', repo_created_at: '2025-01-01T00:00:00Z' };
  assert.equal(compareForCanonical(a, b), -1);
});

test('enrich: skill with no matching vector → all 3 fields stay null', () => {
  const skills = [
    { id: 'has/vec/SKILL.md', slug: 'has/x',
      is_duplicate: null, canonical_slug: null, novelty_score: null,
      repo_created_at: '2024-01-01T00:00:00Z' },
    { id: 'no/vec/SKILL.md', slug: 'no/x',
      is_duplicate: null, canonical_slug: null, novelty_score: null,
      repo_created_at: '2024-01-01T00:00:00Z' },
  ];
  const vectors = [
    { id: expectedVid(skills[0].id), values: vec(8, { slot: 0 }) },
  ];
  enrichSkills(skills, vectors);
  // has/vec was assessed:
  assert.equal(skills[0].is_duplicate, false);
  assert.notEqual(skills[0].novelty_score, null);
  // no/vec was not assessed — stays null
  assert.equal(skills[1].is_duplicate, null);
  assert.equal(skills[1].novelty_score, null);
});

test('enrich: idempotent — running twice produces the same output', () => {
  const skills = [
    { id: 'a/b/SKILL.md', slug: 'a/foo', repo_created_at: '2024-01-01T00:00:00Z' },
    { id: 'c/d/SKILL.md', slug: 'c/foo', repo_created_at: '2025-01-01T00:00:00Z' },
  ];
  const vectors = [
    { id: expectedVid(skills[0].id), values: vec(8, { slot: 0 }) },
    { id: expectedVid(skills[1].id), values: vec(8, { slot: 0 }) },
  ];
  enrichSkills(skills, vectors);
  const snap1 = JSON.parse(JSON.stringify(skills));
  enrichSkills(skills, vectors);
  assert.deepEqual(skills, snap1);
});

test('enrich: >64-char skill id joins via sk_<hash> vector id (BLOCKER 1 regression guard)', () => {
  const longId = 'jeremylongshore/claude-code-plugins-plus-skills/skills/some-deep/path/SKILL.md';
  assert.ok(longId.length > 64, 'fixture must exceed 64 chars to exercise SHA branch');

  const expectedLongVid = 'sk_' + createHash('sha256').update(longId).digest('hex').slice(0, 40);

  const skills = [
    { id: longId, slug: 'jeremylongshore/longpath',
      repo_created_at: '2024-01-01T00:00:00Z' },
    { id: 'other/repo/SKILL.md', slug: 'other/foo',
      repo_created_at: '2025-01-01T00:00:00Z' },
  ];
  const vectors = [
    { id: expectedLongVid, values: vec(8, { slot: 0 }) },
    { id: expectedVid(skills[1].id), values: vec(8, { slot: 0 }) },
  ];
  enrichSkills(skills, vectors);
  assert.equal(skills[0].is_duplicate, false);
  assert.notEqual(skills[0].novelty_score, null);
  assert.equal(skills[1].is_duplicate, true);
  assert.equal(skills[1].canonical_slug, 'jeremylongshore/longpath');
});

test('enrich: 3-way duplicate cluster → oldest canonical, other two get same canonical_slug', () => {
  const skills = [
    { id: 'a/r/SKILL.md', slug: 'a/x', repo_created_at: '2024-01-01T00:00:00Z' },
    { id: 'b/r/SKILL.md', slug: 'b/x', repo_created_at: '2024-06-01T00:00:00Z' },
    { id: 'c/r/SKILL.md', slug: 'c/x', repo_created_at: '2025-01-01T00:00:00Z' },
  ];
  const vectors = [
    { id: expectedVid(skills[0].id), values: vec(8, { slot: 0 }) },
    { id: expectedVid(skills[1].id), values: vec(8, { slot: 0 }) },
    { id: expectedVid(skills[2].id), values: vec(8, { slot: 0 }) },
  ];
  enrichSkills(skills, vectors);
  assert.equal(skills[0].is_duplicate, false);
  assert.equal(skills[1].is_duplicate, true);
  assert.equal(skills[2].is_duplicate, true);
  assert.equal(skills[1].canonical_slug, 'a/x');
  assert.equal(skills[2].canonical_slug, 'a/x');
});
