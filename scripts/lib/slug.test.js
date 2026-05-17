import { test } from 'node:test';
import assert from 'node:assert';
import { assignSlugs } from './slug.js';

test('assignSlugs: unique (owner, name) gets canonical slug', () => {
  const skills = [
    { repo_full_name: 'alice/repo1', name: 'foo', slug: 'alice/foo', quality_score: 80 },
    { repo_full_name: 'bob/repo2', name: 'bar', slug: 'bob/bar', quality_score: 70 },
  ];
  const { redirects, collisionCount, recordsChanged } = assignSlugs(skills);
  assert.equal(skills[0].slug, 'alice/foo');
  assert.equal(skills[1].slug, 'bob/bar');
  assert.equal(collisionCount, 0);
  assert.equal(recordsChanged, 0);
  assert.deepEqual(redirects, {});
});

test('assignSlugs: colliding (owner, name) gets owner/repo/name; redirect emitted to winner', () => {
  const skills = [
    { repo_full_name: 'microsoft/skills',       name: 'azure-aigateway', slug: 'microsoft/azure-aigateway', quality_score: 70 },
    { repo_full_name: 'microsoft/azure-skills', name: 'azure-aigateway', slug: 'microsoft/azure-aigateway', quality_score: 85 },
  ];
  const { redirects, collisionCount, recordsChanged } = assignSlugs(skills);
  assert.equal(skills[0].slug, 'microsoft/skills/azure-aigateway');
  assert.equal(skills[1].slug, 'microsoft/azure-skills/azure-aigateway');
  assert.equal(collisionCount, 1);
  assert.equal(recordsChanged, 2);
  // Winner = quality 85 → microsoft/azure-skills
  assert.equal(redirects['microsoft/azure-aigateway'], 'microsoft/azure-skills/azure-aigateway');
});

test('assignSlugs: tie on quality_score → shorter repo_full_name wins', () => {
  const skills = [
    { repo_full_name: 'org/longer-repo-name',  name: 'thing', slug: 'org/thing', quality_score: 80 },
    { repo_full_name: 'org/short',             name: 'thing', slug: 'org/thing', quality_score: 80 },
  ];
  const { redirects } = assignSlugs(skills);
  assert.equal(redirects['org/thing'], 'org/short/thing');
});

test('assignSlugs: three-way collision resolves all to distinct slugs', () => {
  const skills = [
    { repo_full_name: 'a/r1', name: 'x', slug: 'a/x', quality_score: 70 },
    { repo_full_name: 'a/r2', name: 'x', slug: 'a/x', quality_score: 80 },
    { repo_full_name: 'a/r3', name: 'x', slug: 'a/x', quality_score: 75 },
  ];
  assignSlugs(skills);
  const slugs = new Set(skills.map(s => s.slug));
  assert.equal(slugs.size, 3);
});

test('assignSlugs: handles missing name or repo_full_name gracefully', () => {
  const skills = [
    { repo_full_name: '', name: 'x', slug: '' },
    { repo_full_name: 'a/b', name: '', slug: '' },
    { repo_full_name: 'a/b', name: 'ok', slug: 'a/ok', quality_score: 50 },
  ];
  // Should not throw
  assignSlugs(skills);
  assert.equal(skills[2].slug, 'a/ok');
});
