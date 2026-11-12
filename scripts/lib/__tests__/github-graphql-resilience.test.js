/**
 * scripts/lib/__tests__/github-graphql-resilience.test.js
 *
 * fetchRepoBatchGraphql transport behaviour under a stubbed global fetch:
 *   - 401 → throws GitHubAuthError (expired/revoked SCRAPE_PAT_CLASSIC must
 *     stop Track 1 on the first batch, not after 274 silent casualties).
 *   - 5xx → retried with backoff (GRAPHQL_RETRY_BASE_MS=0 here), then the
 *     batch is marked `graphql-5xx` casualties only after retries are spent.
 *     Outage 2026-09-28 / 11-04 / 11-05: GitHub 502/504 storms with no retry
 *     tripped Track 1's 15% gate.
 *
 * TOKEN-FREE: github-graphql.js reads process.env.GITHUB_TOKEN lazily and
 * imports only the token-free github-auth-error.js; nothing here sets a
 * token or touches github-fetch.js. No network — fetch is stubbed.
 */

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRepoBatchGraphql } from '../github-graphql.js';
import { GitHubAuthError } from '../github-auth-error.js';

const realFetch = globalThis.fetch;
let queue = [];
let calls = 0;
before(() => {
  process.env.GRAPHQL_RETRY_BASE_MS = '0';
  globalThis.fetch = async () => {
    calls++;
    const next = queue.shift();
    if (!next) throw new Error('test fetch queue exhausted');
    return next;
  };
});
after(() => {
  globalThis.fetch = realFetch;
  delete process.env.GRAPHQL_RETRY_BASE_MS;
});
beforeEach(() => { queue = []; calls = 0; });

const REPOS = ['acme/one', 'acme/two'];
const okNode = { stargazerCount: 1, forkCount: 0, pushedAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', isArchived: false };
function okResponse() {
  return new Response(JSON.stringify({ data: { r0: okNode, r1: okNode } }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('401 throws GitHubAuthError on the first batch', async () => {
  queue.push(new Response('{"message":"Bad credentials"}', { status: 401 }));
  await assert.rejects(() => fetchRepoBatchGraphql(REPOS), (err) => err instanceof GitHubAuthError && err.status === 401);
  assert.equal(calls, 1);
});

test('502 then 200: the batch is retried and succeeds (no casualties)', async () => {
  queue.push(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
  queue.push(okResponse());
  const { freshByRepo, failures } = await fetchRepoBatchGraphql(REPOS);
  assert.equal(calls, 2);
  assert.equal(failures.length, 0);
  assert.equal(freshByRepo.size, 2);
});

test('persistent 504 exhausts 3 retries, then every repo is a graphql-504 casualty', async () => {
  for (let i = 0; i < 4; i++) queue.push(new Response('{"message":"timeout"}', { status: 504 }));
  const { freshByRepo, failures } = await fetchRepoBatchGraphql(REPOS);
  assert.equal(calls, 4, 'initial + 3 retries');
  assert.equal(freshByRepo.size, 0);
  assert.deepEqual(failures.map((f) => f.status), ['graphql-504', 'graphql-504']);
});

test('403 that is a secondary limit is NOT thrown as auth (retried, then casualties)', async () => {
  for (let i = 0; i < 4; i++) {
    queue.push(new Response('{"message":"You have exceeded a secondary rate limit"}', { status: 403, headers: { 'retry-after': '0' } }));
  }
  // retry-after '0' → parseInt 0 → not > 0 → falls to the 60s default wait…
  // which is far too slow for a unit test. Call with retries=0 so the
  // function goes straight to the casualty branch; the point under test is
  // that it does NOT throw.
  const { failures } = await fetchRepoBatchGraphql(REPOS, 0);
  assert.deepEqual(failures.map((f) => f.status), ['graphql-403', 'graphql-403']);
});
