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
  assignSlugs(skills);
  assert.equal(skills[2].slug, 'a/ok');
});

// ---------------------------------------------------------------------------
// Phase 4.1 / D-05: api and dataset slugs through the shared assigner.
// ---------------------------------------------------------------------------

test('4.1-M09/D-05: api slugs as provider/name with null repo_full_name', () => {
  const apis = [
    {
      entity_type: 'api',
      name: 'stripe',
      slug: '',
      quality_score: 70,
      repo_full_name: null,
      extra: { provider: 'stripe.com', base_urls: ['https://api.stripe.com/'] },
    },
  ];
  const { collisionCount } = assignSlugs(apis);
  assert.equal(apis[0].slug, 'stripe.com/stripe');
  assert.equal(collisionCount, 0);
});

test('4.1-M09/D-05: api with a known GitHub repo still slugs as provider/name', () => {
  const apis = [
    {
      entity_type: 'api',
      name: 'github',
      slug: '',
      quality_score: 90,
      repo_full_name: 'github/rest-api-description',
      extra: { provider: 'github.com', base_urls: ['https://api.github.com/'] },
    },
  ];
  assignSlugs(apis);
  // D-05: provider wins over the repo owner.
  assert.equal(apis[0].slug, 'github.com/github');
});

test('4.1-M09/D-05: dataset slugs as publisher/name', () => {
  const datasets = [
    {
      entity_type: 'dataset',
      name: 'simready-assets',
      slug: '',
      quality_score: 60,
      repo_full_name: null,
      origin: { source: 'huggingface' },
      extra: { publisher: 'nvidia' },
    },
  ];
  assignSlugs(datasets);
  assert.equal(datasets[0].slug, 'nvidia/simready-assets');
});

test('4.1-M09/D-05: api and skill with the same owner/name slug independently in per-type calls', () => {
  const skills = [{ repo_full_name: 'acme/tools', name: 'foo', slug: '', quality_score: 50 }];
  const skillRes = assignSlugs(skills);
  assert.equal(skills[0].slug, 'acme/foo');
  assert.equal(skillRes.collisionCount, 0);

  const apis = [
    {
      entity_type: 'api',
      name: 'foo',
      slug: '',
      quality_score: 50,
      repo_full_name: null,
      extra: { provider: 'acme', base_urls: ['https://a.acme.com/'] },
    },
  ];
  const apiRes = assignSlugs(apis);
  assert.equal(apis[0].slug, 'acme/foo');
  assert.equal(apiRes.collisionCount, 0);
});

test('4.1-M09/D-05: two apis with the same provider/name collide to provider/host/name with a redirect to the higher score', () => {
  const colliding = [
    {
      entity_type: 'api',
      name: 'foo',
      slug: '',
      quality_score: 80,
      repo_full_name: null,
      extra: { provider: 'acme', base_urls: ['https://a.acme.com/'] },
    },
    {
      entity_type: 'api',
      name: 'foo',
      slug: '',
      quality_score: 60,
      repo_full_name: null,
      extra: { provider: 'acme', base_urls: ['https://b.acme.com/'] },
    },
  ];
  const res = assignSlugs(colliding);
  assert.equal(colliding[0].slug, 'acme/a.acme.com/foo');
  assert.equal(colliding[1].slug, 'acme/b.acme.com/foo');
  assert.equal(res.redirects['acme/foo'], 'acme/a.acme.com/foo');
  assert.equal(res.collisionCount, 1);
});
