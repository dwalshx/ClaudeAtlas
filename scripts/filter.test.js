// scripts/filter.test.js
//
// Unit tests for R3 merge semantics. Approach: import applyTrack1Freshness
// directly and drive it with in-memory fixtures. No subprocess, no I/O.
// (Per C8 of 3.0.0-PLAN-CHECK: subprocess fallback was the alternative,
// not chosen because exporting the helper from filter.js is non-invasive.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTrack1Freshness, filterRaw } from './filter.js';
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

// ---------------------------------------------------------------------------
// Phase 3.1 filter behavior — tests for MIN_STARS drop, MIN_BODY_LENGTH=200,
// MAX_PER_REPO drop, slug pass, placeholder enrichment fields.
// ---------------------------------------------------------------------------

function makeAdmissible(overrides = {}) {
  return {
    id: `${overrides.repo_full_name || 'a/b'}/${overrides.name || 'good'}/SKILL.md`,
    repo_full_name: 'a/b',
    name: 'good',
    slug: 'a/good',
    description: 'A genuine skill description that is substantive.',
    category: 'general',
    body_length: 300,
    body_markdown: 'x'.repeat(300),
    has_name: true,
    has_description: true,
    frontmatter: { name: 'good', description: 'desc' },
    repo_stars: 0,
    repo_forks: 0,
    repo_open_issues: 0,
    repo_topics: [],
    repo_license: 'MIT',
    repo_language: 'JavaScript',
    repo_created_at: '2024-01-01T00:00:00Z',
    repo_updated_at: '2026-01-01T00:00:00Z',
    repo_pushed_at: '2026-05-01T00:00:00Z',
    repo_description: 'A test repo',
    quality_score: 50,
    ...overrides,
  };
}

test('Phase 3.1: no MIN_STARS gate — 0-star record with good signals is admitted', () => {
  const raw = [makeAdmissible({ repo_stars: 0 })];
  const { capped } = filterRaw(raw);
  assert.equal(capped.length, 1);
  assert.equal(capped[0].is_duplicate, null);
  assert.equal(capped[0].canonical_slug, null);
  assert.equal(capped[0].novelty_score, null);
});

test('Phase 3.1: body_length=199 rejected, body_length=200 admitted', () => {
  const raw = [
    makeAdmissible({ id: 'a/b/short/SKILL.md', name: 'short', slug: 'a/short',
      body_length: 199, body_markdown: 'x'.repeat(199) }),
    makeAdmissible({ id: 'a/b/edge/SKILL.md', name: 'edge', slug: 'a/edge',
      body_length: 200, body_markdown: 'x'.repeat(200) }),
  ];
  const { capped } = filterRaw(raw);
  assert.equal(capped.length, 1);
  assert.equal(capped[0].name, 'edge');
});

test('Phase 3.1: 100 records from one repo all survive (no MAX_PER_REPO)', () => {
  const raw = Array.from({ length: 100 }, (_, i) => makeAdmissible({
    id: `a/b/skill-${i}/SKILL.md`,
    name: `skill-${i}`,
    slug: `a/skill-${i}`,
    body_length: 300,
    body_markdown: 'x'.repeat(300),
  }));
  const { capped } = filterRaw(raw);
  assert.equal(capped.length, 100);
});

test('Phase 3.1: (owner, name) collision yields distinct slugs and a redirect entry to the winner', () => {
  const raw = [
    makeAdmissible({
      id: 'microsoft/skills/azure-aigateway/SKILL.md',
      repo_full_name: 'microsoft/skills',
      name: 'azure-aigateway',
      slug: 'microsoft/azure-aigateway',
      quality_score: 70,
    }),
    makeAdmissible({
      id: 'microsoft/azure-skills/azure-aigateway/SKILL.md',
      repo_full_name: 'microsoft/azure-skills',
      name: 'azure-aigateway',
      slug: 'microsoft/azure-aigateway',
      quality_score: 85,
    }),
  ];
  const { capped, redirects, collisionCount } = filterRaw(raw);
  assert.equal(capped.length, 2);
  const slugs = new Set(capped.map(s => s.slug));
  assert.equal(slugs.size, 2);
  assert.equal(collisionCount, 1);
  // Higher quality_score wins (85 > 70) → microsoft/azure-skills is canonical.
  assert.equal(redirects['microsoft/azure-aigateway'], 'microsoft/azure-skills/azure-aigateway');
});

test('Phase 3.1: PRESERVED_FIELDS carries is_duplicate / canonical_slug / novelty_score from prior', () => {
  const raw = [makeAdmissible({ id: 'p/q/foo/SKILL.md', repo_full_name: 'p/q',
    name: 'foo', slug: 'p/foo' })];
  const priorEnrichments = new Map([['p/q/foo/SKILL.md', {
    is_duplicate: true,
    canonical_slug: 'older/foo',
    novelty_score: 0.42,
  }]]);
  const { capped } = filterRaw(raw, new Map(), priorEnrichments);
  assert.equal(capped.length, 1);
  // Step 4b sets placeholders to null; Step 4c restores from prior because
  // `s[field] == null && prior[field] != null` holds.
  assert.equal(capped[0].is_duplicate, true);
  assert.equal(capped[0].canonical_slug, 'older/foo');
  assert.equal(capped[0].novelty_score, 0.42);
});

test('Security: record from a fixture-repo-denylist repo is dropped', () => {
  // claude-world/claude-skill-antivirus and cisco-ai-defense/skill-scanner are
  // skill-scanner / eval-corpus repos whose SKILL.md files are deliberate test
  // fixtures (malicious + benign samples), NOT real skills. Every record from
  // them must be dropped on every filter pass.
  const raw = [
    makeAdmissible({
      id: 'claude-world/claude-skill-antivirus/super-helper/SKILL.md',
      repo_full_name: 'claude-world/claude-skill-antivirus',
      name: 'super-helper',
      slug: 'claude-world/super-helper',
    }),
    makeAdmissible({
      id: 'cisco-ai-defense/skill-scanner/jailbreak-override/SKILL.md',
      repo_full_name: 'cisco-ai-defense/skill-scanner',
      name: 'jailbreak-override',
      slug: 'cisco-ai-defense/jailbreak-override',
    }),
    makeAdmissible({
      id: 'real/repo/legit-skill/SKILL.md',
      repo_full_name: 'real/repo',
      name: 'legit-skill',
      slug: 'real/legit-skill',
    }),
  ];
  const { capped } = filterRaw(raw);
  assert.equal(capped.length, 1);
  assert.equal(capped[0].repo_full_name, 'real/repo');
});

test('Security: non-denylisted repo with an examples/ path is KEPT (no over-removal)', () => {
  // Guards against accidentally adding path-based examples/evals/tests
  // exclusion. ~95 legitimate example skills live under examples/ in
  // guide/tutorial repos and must survive.
  const raw = [makeAdmissible({
    id: 'guide/tutorial-repo/examples/my-example/SKILL.md',
    repo_full_name: 'guide/tutorial-repo',
    name: 'my-example',
    slug: 'guide/my-example',
  })];
  const { capped } = filterRaw(raw);
  assert.equal(capped.length, 1);
  assert.equal(capped[0].repo_full_name, 'guide/tutorial-repo');
});

test('Phase 3.2 F-3: filter re-run preserves bundled_in_plugins from prior', () => {
  const raw = [makeAdmissible({ id: 'p/q/foo/SKILL.md', repo_full_name: 'p/q',
    name: 'foo', slug: 'p/foo' })];
  // A skill that link-bundles.js previously linked into a plugin. On the next
  // filter run the raw record has no bundled_in_plugins; it must be restored
  // from the prior enrichment rather than reset to [].
  const priorEnrichments = new Map([['p/q/foo/SKILL.md', {
    bundled_in_plugins: ['plugin:x/y/.claude-plugin/plugin.json'],
  }]]);
  const { capped } = filterRaw(raw, new Map(), priorEnrichments);
  assert.equal(capped.length, 1);
  assert.deepEqual(capped[0].bundled_in_plugins, ['plugin:x/y/.claude-plugin/plugin.json']);
});
