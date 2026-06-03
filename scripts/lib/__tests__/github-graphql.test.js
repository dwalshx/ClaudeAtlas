/**
 * scripts/lib/__tests__/github-graphql.test.js
 *
 * Unit tests for the Track 1 GraphQL batch client's PURE functions
 * (mapGraphqlRepoToFields + buildPulseQuery) against inline fixture GraphQL
 * repository nodes. `node --test` only — no external framework.
 *
 * TOKEN-FREE / NETWORK-FREE guarantee: github-graphql.js imports NOTHING from
 * github-fetch.js (it defines a local `sleep`), so importing it does not trip
 * github-fetch.js's module-load `process.exit(1)` when GITHUB_TOKEN is unset.
 * This test MUST NOT set process.env.GITHUB_TOKEN and MUST NOT import
 * github-fetch.js. All fixtures are inline — no network.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { mapGraphqlRepoToFields, buildPulseQuery } from '../github-graphql.js';
import { TRACK1_FRESHNESS_FIELDS } from '../skill-fields.js';

// A fully-populated GraphQL repository node fixture.
function fullNode() {
  return {
    stargazerCount: 1234,
    forkCount: 56,
    pushedAt: '2026-06-01T12:00:00Z',
    updatedAt: '2026-06-02T08:30:00Z',
    isArchived: false,
    description: 'A test repo',
    primaryLanguage: { name: 'TypeScript' },
    licenseInfo: { spdxId: 'MIT', key: 'mit' },
    defaultBranchRef: { name: 'main' },
    repositoryTopics: {
      nodes: [
        { topic: { name: 'claude' } },
        { topic: { name: 'skills' } },
      ],
    },
    issues: { totalCount: 7 },
    pullRequests: { totalCount: 3 },
  };
}

// Test 1 — emits EXACTLY the 11 TRACK1_FRESHNESS_FIELDS keys (no more, no less).
test('mapGraphqlRepoToFields emits exactly the 11 TRACK1_FRESHNESS_FIELDS', () => {
  const fields = mapGraphqlRepoToFields(fullNode());
  const got = Object.keys(fields).sort();
  const want = [...TRACK1_FRESHNESS_FIELDS].sort();
  assert.deepEqual(got, want);
  assert.equal(got.length, 11);
});

// Test 2 — D2 parity: repo_open_issues = open issues + open PRs.
test('repo_open_issues = issues.totalCount + pullRequests.totalCount (D2 parity)', () => {
  const fields = mapGraphqlRepoToFields(fullNode()); // issues=7, PRs=3
  assert.equal(fields.repo_open_issues, 10);
  // Guard against an accidental issues-only regression: must NOT equal 7.
  assert.notEqual(fields.repo_open_issues, 7);
});

// Test 3 — nullish defaults on a sparse node.
test('sparse node maps to null/[]/0 defaults', () => {
  const sparse = {
    stargazerCount: 0,
    forkCount: 0,
    pushedAt: null,
    updatedAt: null,
    isArchived: false,
    description: null,
    // licenseInfo, primaryLanguage, defaultBranchRef, repositoryTopics absent
    // issues / pullRequests absent
  };
  const fields = mapGraphqlRepoToFields(sparse);
  assert.equal(fields.repo_license, null);
  assert.equal(fields.repo_language, null);
  assert.equal(fields.repo_default_branch, null);
  assert.deepEqual(fields.repo_topics, []);
  assert.equal(fields.repo_open_issues, 0);
  assert.equal(fields.repo_stars, 0);
  assert.equal(fields.repo_forks, 0);
  assert.equal(fields.repo_archived, false);
});

// Test 4 — topics flattening.
test('repo_topics flattens repositoryTopics.nodes[].topic.name to a string array', () => {
  const fields = mapGraphqlRepoToFields(fullNode());
  assert.deepEqual(fields.repo_topics, ['claude', 'skills']);
  assert.ok(fields.repo_topics.every((t) => typeof t === 'string'));
});

// Test 5 — license prefers spdxId, falls back to key, else null.
test('repo_license prefers spdxId, falls back to key, else null', () => {
  const withSpdx = mapGraphqlRepoToFields({ licenseInfo: { spdxId: 'Apache-2.0', key: 'apache-2.0' } });
  assert.equal(withSpdx.repo_license, 'Apache-2.0');

  const keyOnly = mapGraphqlRepoToFields({ licenseInfo: { spdxId: null, key: 'other' } });
  assert.equal(keyOnly.repo_license, 'other');

  const none = mapGraphqlRepoToFields({ licenseInfo: null });
  assert.equal(none.repo_license, null);
});

// Test 6 — buildPulseQuery: N aliased blocks + round-trip aliasMap + first-slash split.
test('buildPulseQuery produces N aliased blocks and a round-trip aliasMap', () => {
  const repos = ['anthropics/claude-code', 'withastro/astro', 'openai/openai-node'];
  const { query, aliasMap } = buildPulseQuery(repos);

  // One aliased repository(...) block per repo.
  const aliasBlocks = query.match(/r\d+:\s*repository\(/g) || [];
  assert.equal(aliasBlocks.length, repos.length);

  // aliasMap round-trips alias -> repoFullName.
  assert.equal(aliasMap.r0, 'anthropics/claude-code');
  assert.equal(aliasMap.r1, 'withastro/astro');
  assert.equal(aliasMap.r2, 'openai/openai-node');

  // owner/name split on the FIRST slash.
  assert.match(query, /repository\(owner: "anthropics", name: "claude-code"\)/);
  assert.match(query, /repository\(owner: "withastro", name: "astro"\)/);

  // Field set includes the D2 issues + PRs counts.
  assert.match(query, /issues\(states: OPEN\)/);
  assert.match(query, /pullRequests\(states: OPEN\)/);
});

// Test 7 — null-alias casualty handling (the caller's resolution branch).
// Mirrors fetchRepoBatchGraphql's per-alias loop: data[alias] === null is a
// tolerated casualty; only non-null nodes are mapped.
test('null alias is treated as a casualty, not mapped', () => {
  const aliasMap = { r0: 'deleted/repo', r1: 'live/repo' };
  const response = {
    data: { r0: null, r1: fullNode() },
    errors: [{ type: 'NOT_FOUND', path: ['r0'] }],
  };

  const freshByRepo = new Map();
  const failures = [];
  for (const [alias, repoFullName] of Object.entries(aliasMap)) {
    const node = response.data[alias];
    if (node == null) {
      failures.push({ repoFullName, status: 'graphql-null' });
    } else {
      freshByRepo.set(repoFullName, mapGraphqlRepoToFields(node));
    }
  }

  // r0 (null) → casualty; r1 → mapped.
  assert.equal(failures.length, 1);
  assert.equal(failures[0].repoFullName, 'deleted/repo');
  assert.equal(failures[0].status, 'graphql-null');
  assert.equal(freshByRepo.size, 1);
  assert.ok(freshByRepo.has('live/repo'));
  assert.equal(freshByRepo.get('live/repo').repo_stars, 1234);
  // A non-empty errors[] alongside partial data is NOT a whole-query failure.
  assert.ok(Array.isArray(response.errors) && response.errors.length > 0);
});
