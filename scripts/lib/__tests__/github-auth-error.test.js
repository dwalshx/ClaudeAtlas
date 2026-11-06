/**
 * scripts/lib/__tests__/github-auth-error.test.js
 *
 * Pure-function tests for the auth-failure classifier that every GitHub
 * scraper now consults before treating a non-OK response as "skip".
 * Token-free, network-free (`node --test`).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAuthFailure, GitHubAuthError, describeAuthFailure } from '../github-auth-error.js';

function res(status, headers = {}) {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { status, headers: { get: (n) => map.get(n.toLowerCase()) ?? null } };
}

test('401 is always an auth failure (expired / revoked / bad token)', () => {
  assert.equal(isAuthFailure(res(401)), true);
  assert.equal(isAuthFailure(res(401), '{"message":"Bad credentials"}'), true);
});

test('403 with retry-after is a SECONDARY rate limit, not auth', () => {
  assert.equal(isAuthFailure(res(403, { 'retry-after': '30' }), 'abuse'), false);
});

test('403 with x-ratelimit-remaining: 0 is the PRIMARY limit, not auth', () => {
  assert.equal(isAuthFailure(res(403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1' }), 'API rate limit exceeded'), false);
});

test('403 with a credential/scope body IS an auth failure', () => {
  assert.equal(isAuthFailure(res(403, { 'x-ratelimit-remaining': '4999' }), '{"message":"Resource not accessible by personal access token"}'), true);
  assert.equal(isAuthFailure(res(403), '{"message":"Bad credentials"}'), true);
  assert.equal(isAuthFailure(res(403), 'Resource protected by organization SAML enforcement.'), true);
});

test('403 "Repository access blocked" is a per-repo casualty, not auth', () => {
  assert.equal(isAuthFailure(res(403, { 'x-ratelimit-remaining': '4999' }), '{"message":"Repository access blocked","block":{"reason":"tos"}}'), false);
});

test('other statuses are never auth failures', () => {
  for (const s of [200, 304, 404, 422, 429, 451, 500, 502]) {
    assert.equal(isAuthFailure(res(s), 'Bad credentials'), false, `status ${s}`);
  }
  assert.equal(isAuthFailure(null), false);
  assert.equal(isAuthFailure({}), false);
});

test('GitHubAuthError carries status + url and describeAuthFailure names the secret, never a token', () => {
  const err = new GitHubAuthError(401, 'https://api.github.com/search/repositories?q=x', '{"message":"Bad credentials"}');
  assert.equal(err.name, 'GitHubAuthError');
  assert.equal(err.status, 401);
  assert.match(err.message, /HTTP 401/);
  const text = describeAuthFailure(err, { secretName: 'SCRAPE_PAT', tag: '[discover]' });
  assert.match(text, /\[discover\] FATAL/);
  assert.match(text, /SCRAPE_PAT/);
  assert.match(text, /Recovery: expired GitHub PAT/);
  assert.doesNotMatch(text, /ghp_|github_pat_/);
});
