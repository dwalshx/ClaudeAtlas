// scripts/embed-skills.test.js
//
// Unit tests for the FIX A drift decision (quick-260804-dy2). Approach:
// import shouldBailOnDrift directly and drive it with in-memory scalars.
// No subprocess, no I/O, no OpenAI call — main() is import-guarded by
// invokedAsScript, so importing the helper does not run the embedder.
//
// Run explicitly: node --test scripts/embed-skills.test.js
// (the drift helper is a pure function; the three scenarios below mirror
// the plan <behavior> A/B/C.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldBailOnDrift,
  MIN_PRIOR_FOR_DRIFT_CHECK,
  PRIOR_MATCH_BAIL_THRESHOLD,
} from './embed-skills.js';

// Test A — catalog growth / cold-seed (the 7-17 false-positive scenario).
// 1,078-vector seed, 980 still match a current record (priorMatchRate ~0.91),
// while the overall catalog is ~50k records (the OLD hitRate would be ~2% and
// would WRONGLY bail). Prior-overlap signal → PROCEED.
test('Test A: catalog growth / cold-seed with high prior-overlap PROCEEDS', () => {
  const bail = shouldBailOnDrift({
    priorCount: 1078,
    matchedFromPrior: 980, // ~0.909 prior-match-rate
    forced: false,
  });
  assert.equal(bail, false, 'high prior-overlap must NOT bail even amid catalog growth');
});

// Test B — real embedding-input / content_sha drift. Most prior vectors no
// longer match (priorMatchRate=0.20 < 0.5) → BAIL. Same inputs with
// forced=true → PROCEED (EMBED_FORCE_REEMBED override preserved).
test('Test B: real drift BAILS, but forced=true overrides', () => {
  const bail = shouldBailOnDrift({
    priorCount: 1000,
    matchedFromPrior: 200, // 0.20 prior-match-rate
    forced: false,
  });
  assert.equal(bail, true, 'majority-miss prior-overlap must bail (true drift)');

  const forced = shouldBailOnDrift({
    priorCount: 1000,
    matchedFromPrior: 200,
    forced: true,
  });
  assert.equal(forced, false, 'forced=true must override the drift bail');
});

// Test C — evicted / bootstrap remnant. Zero prior (fresh cache) and a
// below-floor prior set are both statistically meaningless → PROCEED.
test('Test C: tiny / empty prior set PROCEEDS (no spurious bail)', () => {
  assert.equal(
    shouldBailOnDrift({ priorCount: 0, matchedFromPrior: 0, forced: false }),
    false,
    'zero prior (fresh/evicted cache) must proceed',
  );
  assert.equal(
    shouldBailOnDrift({ priorCount: 10, matchedFromPrior: 0, forced: false }),
    false,
    'below-MIN_PRIOR floor must proceed even with 0 matches',
  );
});

// Guard: the exported thresholds are the documented values (regression
// tripwire if a future edit silently reverts to the 0.90 hit-rate gate).
test('exported thresholds match the documented choices', () => {
  assert.equal(MIN_PRIOR_FOR_DRIFT_CHECK, 50);
  assert.equal(PRIOR_MATCH_BAIL_THRESHOLD, 0.5);
});
