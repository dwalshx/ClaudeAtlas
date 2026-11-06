/**
 * scripts/__tests__/check-github-tokens.test.js
 *
 * Pure-verdict tests for the token preflight (assessToken + parseExpiration).
 * Network-free; the script's main() is gated behind an invoked-as-script
 * guard so importing it here makes no requests.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessToken, parseExpiration, REQUIRED_TOKENS } from '../check-github-tokens.js';

const NOW = Date.parse('2026-11-05T12:00:00Z');

test('parseExpiration handles GitHub\'s "YYYY-MM-DD HH:MM:SS UTC" header and absence', () => {
  assert.equal(parseExpiration('2026-10-14 20:37:52 UTC'), Date.parse('2026-10-14T20:37:52Z'));
  assert.equal(parseExpiration(null), null);
  assert.equal(parseExpiration(''), null);
  assert.equal(parseExpiration('not a date'), null);
});

test('missing secret → fail', () => {
  const v = assessToken({ name: 'SCRAPE_PAT', present: false, now: NOW });
  assert.equal(v.level, 'fail');
  assert.match(v.message, /NOT SET/);
});

test('REST 401 → fail with a rotate hint', () => {
  const v = assessToken({ name: 'SCRAPE_PAT', status: 401, now: NOW });
  assert.equal(v.level, 'fail');
  assert.match(v.message, /expired or revoked/);
});

test('REST 200 but GraphQL non-200 → fail (classic PAT required for Track 1)', () => {
  const v = assessToken({ name: 'SCRAPE_PAT_CLASSIC', status: 200, graphqlStatus: 403, now: NOW });
  assert.equal(v.level, 'fail');
  assert.match(v.message, /CLASSIC PAT/);
});

test('200 with no expiration header → ok (non-expiring token)', () => {
  const v = assessToken({ name: 'SCRAPE_PAT_CLASSIC', status: 200, expiration: null, graphqlStatus: 200, now: NOW });
  assert.equal(v.level, 'ok');
  assert.equal(v.daysLeft, null);
});

test('200 expiring in 60 days → ok; in 10 days → warn; already past → fail', () => {
  const ok = assessToken({ name: 'SCRAPE_PAT', status: 200, expiration: '2027-01-04 12:00:00 UTC', now: NOW });
  assert.equal(ok.level, 'ok');
  assert.ok(ok.daysLeft > 59 && ok.daysLeft < 61);

  const warn = assessToken({ name: 'SCRAPE_PAT', status: 200, expiration: '2026-11-15 12:00:00 UTC', now: NOW, warnDays: 14 });
  assert.equal(warn.level, 'warn');
  assert.match(warn.message, /EXPIRES in 10\.0 days/);

  const past = assessToken({ name: 'SCRAPE_PAT', status: 200, expiration: '2026-10-14 20:37:52 UTC', now: NOW });
  assert.equal(past.level, 'fail');
  assert.match(past.message, /expired on 2026-10-14/);
});

test('warnDays threshold is respected', () => {
  const v = assessToken({ name: 'SCRAPE_PAT', status: 200, expiration: '2026-11-15 12:00:00 UTC', now: NOW, warnDays: 5 });
  assert.equal(v.level, 'ok');
});

test('REQUIRED_TOKENS covers both pipeline PATs, GraphQL probe only on the classic one', () => {
  const names = REQUIRED_TOKENS.map((t) => t.name).sort();
  assert.deepEqual(names, ['SCRAPE_PAT', 'SCRAPE_PAT_CLASSIC']);
  assert.equal(REQUIRED_TOKENS.find((t) => t.name === 'SCRAPE_PAT').graphql, false);
  assert.equal(REQUIRED_TOKENS.find((t) => t.name === 'SCRAPE_PAT_CLASSIC').graphql, true);
});
