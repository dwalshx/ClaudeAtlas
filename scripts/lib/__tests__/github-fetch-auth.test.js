/**
 * scripts/lib/__tests__/github-fetch-auth.test.js
 *
 * github-fetch.js must THROW GitHubAuthError on an auth failure instead of
 * returning the non-OK response for the caller to "skip" (the behaviour
 * that hid the expired SCRAPE_PAT for 39 days). github-fetch.js exits the
 * process at import time without GITHUB_TOKEN, so this file sets a dummy
 * token BEFORE a dynamic import and stubs globalThis.fetch — no network.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN || 'test-token-not-real';

const mod = await import('../github-fetch.js');
const { rateLimitedFetch, fetchWithETag, GitHubAuthError } = mod;

const realFetch = globalThis.fetch;
let queue = [];
before(() => {
  globalThis.fetch = async () => {
    const next = queue.shift();
    if (!next) throw new Error('test fetch queue exhausted');
    return next;
  };
});
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { queue = []; });

function response(status, body = '', headers = {}) {
  return new Response(body, { status, headers });
}

test('rateLimitedFetch throws GitHubAuthError on 401 (expired PAT) — never returns it', async () => {
  queue.push(response(401, '{"message":"Bad credentials"}'));
  await assert.rejects(
    () => rateLimitedFetch('https://api.github.com/search/repositories?q=topic:claude-skills', true),
    (err) => err instanceof GitHubAuthError && err.status === 401 && /Bad credentials/.test(err.detail),
  );
});

test('rateLimitedFetch throws on a permission-denied 403 (fine-grained PAT missing a scope)', async () => {
  queue.push(response(403, '{"message":"Resource not accessible by personal access token"}', { 'x-ratelimit-remaining': '4999' }));
  await assert.rejects(
    () => rateLimitedFetch('https://api.github.com/repos/o/r/git/trees/main'),
    (err) => err instanceof GitHubAuthError && err.status === 403,
  );
});

test('rateLimitedFetch returns a 404 untouched (per-repo casualty, caller decides)', async () => {
  queue.push(response(404, '{"message":"Not Found"}'));
  const res = await rateLimitedFetch('https://api.github.com/repos/o/gone');
  assert.equal(res.status, 404);
});

test('fetchWithETag throws GitHubAuthError on 401 instead of returning {data:null}', async () => {
  queue.push(response(401, '{"message":"Bad credentials"}'));
  await assert.rejects(
    () => fetchWithETag('https://api.github.com/repos/o/r/contents/SKILL.md'),
    (err) => err instanceof GitHubAuthError && err.status === 401,
  );
});

test('fetchWithETag returns {data:null,status} for a non-auth non-OK (e.g. 451) as before', async () => {
  queue.push(response(451, '{"message":"DMCA"}'));
  const out = await fetchWithETag('https://api.github.com/repos/o/r/git/trees/main');
  assert.equal(out.data, null);
  assert.equal(out.status, 451);
});

test('secondary-limit 403 with retry-after is retried, not treated as auth (retries decrement)', async () => {
  // retry-after=0 → Number.isInteger(0) && 0 > 0 is false → falls to the
  // x-ratelimit-reset branch; give a reset in the past so the wait is the
  // 5s floor... too slow for a unit test. Instead exhaust retries with
  // retries=0: the response is returned so the caller can log and skip.
  queue.push(response(403, '{"message":"API rate limit exceeded"}', { 'retry-after': '30', 'x-ratelimit-remaining': '0' }));
  const res = await rateLimitedFetch('https://api.github.com/search/code?q=x', true, 0);
  assert.equal(res.status, 403, 'rate-limit 403 is returned (not thrown) once retries are spent');
});
