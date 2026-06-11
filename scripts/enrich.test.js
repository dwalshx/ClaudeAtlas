import { test } from 'node:test';
import assert from 'node:assert';
import { createHash } from 'node:crypto';
import { enrichSkills, compareForCanonical } from './enrich.js';
import { normalizeFloat32, dot } from './lib/ann.js';

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

test('Task 10: plugin enrich — entity-type-agnostic dedup over 10 plugins flags 2 near-dups', () => {
  // 10 plugins; the last two share a vector with plugin[0] (cosine 1.0 > 0.92).
  // enrichSkills is type-agnostic — it keys on .id/.slug/.repo_created_at, all
  // of which plugin EntityRecords carry. This locks the D-10 plugin enrich path.
  const plugins = [];
  for (let i = 0; i < 10; i++) {
    plugins.push({
      id: `plugin:owner/repo${i}/.claude-plugin/plugin.json`,
      slug: `owner/p${i}`,
      entity_type: 'plugin',
      repo_created_at: `2024-0${(i % 9) + 1}-01T00:00:00Z`,
    });
  }
  // Distinct vectors for 0..7, but 8 and 9 collide with 0 (canonical = oldest).
  const vectors = plugins.map((p, i) => ({
    id: expectedVid(p.id),
    values: vec(16, { slot: i < 8 ? i : 0 }),
  }));
  enrichSkills(plugins, vectors);
  const dups = plugins.filter((p) => p.is_duplicate === true);
  assert.equal(dups.length, 2, 'exactly two near-duplicates flagged');
  // Both duplicates point at plugin[0] (oldest in its cluster: 2024-01).
  assert.equal(plugins[0].is_duplicate, false);
  assert.equal(plugins[8].canonical_slug, plugins[0].slug);
  assert.equal(plugins[9].canonical_slug, plugins[0].slug);
});

// ---------------------------------------------------------------------------
// Phase 3.2.1 Plan 03 — ANN-backed dedup regression locks (Tests F-I).
// These tests are engine-agnostic: on the dev box they exercise the exact
// fallback engine, in lint CI they run on hnsw with ANN_REQUIRE_HNSW=1.
// ann.js exact-verifies every candidate sim, so assertions on enrichSkills
// output hold identically on both engines.
// ---------------------------------------------------------------------------

// Helper: ISO date N days after 2020-01-01 (deterministic staggered dates).
function dayOffset(base, i) {
  return new Date(Date.parse(base) + i * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

test('Test F (determinism): identical input → identical dedup/novelty output across runs', () => {
  // 50 synthetic skills: 2 planted dup clusters (5 members each, sim 1.0
  // within cluster) + 40 unique vectors (distinct hot slots, sim well below
  // 0.92 to everything else). Deterministic construction throughout.
  const DIM = 64;
  const buildFixture = () => {
    const skills = [];
    const rawVecs = [];
    for (let i = 0; i < 50; i++) {
      skills.push({
        id: `det/repo${i}/SKILL.md`,
        slug: `det/s${i}`,
        skill_first_commit_at: dayOffset('2021-01-01T00:00:00Z', i),
        repo_created_at: dayOffset('2021-01-01T00:00:00Z', i),
        repo_pushed_at: '2026-01-01T00:00:00Z',
      });
      if (i < 5) {
        rawVecs.push(vec(DIM, { slot: 0 }));            // cluster 1
      } else if (i < 10) {
        rawVecs.push(vec(DIM, { slot: 1 }));            // cluster 2
      } else {
        // unique: primary slot i, weak secondary component → max pairwise
        // cosine ≈ 0.28, far below DUP_THRESHOLD
        rawVecs.push(vec(DIM, [{ slot: i, value: 1 }, { slot: (i + 1) % DIM, value: 0.3 }]));
      }
    }
    const vectors = skills.map((s, i) => ({ id: expectedVid(s.id), values: rawVecs[i] }));
    return { skills, vectors };
  };

  const run1 = buildFixture();
  const run2 = buildFixture();
  enrichSkills(run1.skills, run1.vectors);
  enrichSkills(run2.skills, run2.vectors);

  const project = (skills) =>
    skills.map((s) => ({
      is_duplicate: s.is_duplicate,
      canonical_slug: s.canonical_slug,
      novelty_score: s.novelty_score,
    }));
  assert.equal(JSON.stringify(project(run1.skills)), JSON.stringify(project(run2.skills)));
});

test('Test G (large cluster > K_DUP=64): 80-member identical-vector cluster → 1 cluster, 79 duplicates', () => {
  // 80 skills share one hot-slot vector (sim = 1.0 cluster, LARGER than
  // K_DUP=64) + 20 unique-vector skills. BFS connectivity must survive
  // top-K truncation: every member's top-64 is dominated by cluster
  // siblings (RESEARCH.md Pattern 2 safety argument, regression-locked).
  const DIM = 32;
  const skills = [];
  const vectors = [];
  for (let i = 0; i < 80; i++) {
    const s = {
      id: `clus/m${i}/SKILL.md`,
      slug: `clus/m${i}`,
      // Staggered daily so canonical selection is deterministic:
      // member 0 is the oldest ('2020-01-01...').
      skill_first_commit_at: dayOffset('2020-01-01T00:00:00Z', i),
      repo_created_at: dayOffset('2020-01-01T00:00:00Z', i),
    };
    skills.push(s);
    vectors.push({ id: expectedVid(s.id), values: vec(DIM, { slot: 0 }) });
  }
  for (let i = 0; i < 20; i++) {
    const s = {
      id: `uniq/u${i}/SKILL.md`,
      slug: `uniq/u${i}`,
      repo_created_at: '2023-01-01T00:00:00Z',
    };
    skills.push(s);
    vectors.push({ id: expectedVid(s.id), values: vec(DIM, { slot: 1 + i }) });
  }

  const { stats } = enrichSkills(skills, vectors);
  assert.equal(stats.clusters, 1, 'exactly one cluster forms');
  assert.equal(stats.duplicates, 79, 'exactly 79 records flagged duplicate');

  const members = skills.slice(0, 80);
  const uniques = skills.slice(80);
  assert.equal(members[0].is_duplicate, false, 'oldest member is canonical');
  assert.equal(members[0].canonical_slug, null);
  for (let i = 1; i < 80; i++) {
    assert.equal(members[i].is_duplicate, true, `member ${i} flagged duplicate`);
    assert.equal(members[i].canonical_slug, 'clus/m0', `member ${i} points at oldest slug`);
  }
  for (const u of uniques) {
    assert.equal(u.is_duplicate, false);
    assert.equal(u.canonical_slug, null);
  }
});

test('Test H (passthrough): skill_first_commit_at + bundled_in_plugins survive enrichSkills untouched', () => {
  // PRESERVED_FIELDS contract interplay: enrich must never mutate these
  // inputs — filter.js preservation depends on them passing through intact.
  const skills = [
    {
      id: 'pres/a/SKILL.md', slug: 'pres/a',
      skill_first_commit_at: '2024-01-01T00:00:00Z',
      bundled_in_plugins: ['plugin:x/y/z'],
      repo_created_at: '2024-01-01T00:00:00Z',
    },
    {
      id: 'pres/b/SKILL.md', slug: 'pres/b',
      skill_first_commit_at: '2024-01-01T00:00:00Z',
      bundled_in_plugins: ['plugin:x/y/z'],
      repo_created_at: '2024-02-01T00:00:00Z',
    },
  ];
  const vectors = [
    { id: expectedVid(skills[0].id), values: vec(8, { slot: 0 }) },
    // skills[1] has NO vector — absent path must also leave fields untouched.
  ];
  enrichSkills(skills, vectors);
  for (const s of skills) {
    assert.equal(s.skill_first_commit_at, '2024-01-01T00:00:00Z');
    assert.deepEqual(s.bundled_in_plugins, ['plugin:x/y/z']);
  }
});

test('Test I (novelty): novelty_score === 1 - exact top-1 sim when nearest neighbor is in top-K', () => {
  // A = one-hot slot 0; B = equal weight on slots 0-3 (normalized: 0.5 each).
  // dot(A, B) = 0.5 exactly (float32-exact), below DUP_THRESHOLD → both
  // non-duplicates, novelty computed from the top-1 sim.
  const rawA = vec(8, { slot: 0 });
  const rawB = vec(8, [
    { slot: 0, value: 1 }, { slot: 1, value: 1 },
    { slot: 2, value: 1 }, { slot: 3, value: 1 },
  ]);
  const skills = [
    { id: 'nov/a/SKILL.md', slug: 'nov/a', repo_created_at: '2024-01-01T00:00:00Z' },
    { id: 'nov/b/SKILL.md', slug: 'nov/b', repo_created_at: '2024-02-01T00:00:00Z' },
  ];
  const vectors = [
    { id: expectedVid(skills[0].id), values: rawA },
    { id: expectedVid(skills[1].id), values: rawB },
  ];
  enrichSkills(skills, vectors);

  // Independent exact computation on the fixture vectors via ann.js math.
  const exactTop1Sim = dot(normalizeFloat32(rawA), normalizeFloat32(rawB));
  assert.equal(exactTop1Sim, 0.5, 'fixture sim is float32-exact');
  assert.equal(skills[0].is_duplicate, false);
  assert.equal(skills[1].is_duplicate, false);
  assert.equal(skills[0].novelty_score, 1 - exactTop1Sim);
  assert.equal(skills[1].novelty_score, 1 - exactTop1Sim);
});
