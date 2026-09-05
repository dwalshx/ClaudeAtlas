/**
 * src/lib/beh-score.test.js — pure structural scorer tests
 * (quick-260905-fib, L4 behavioral beacon, BEH-01).
 *
 * scoreBehavior takes a plain features object (never a Request/DOM), so these
 * run under plain `node --test` with zero browser runtime and zero I/O. Mirror
 * worker/asn-class.test.js import style.
 *
 * These tests encode the SETTLED band contract:
 *   - automation-shaped features → 'automation-signature'
 *   - human-shaped features       → 'human-shaped'
 *   - near-zero interaction / assistive-tech → 'uncertain' (NEVER automation)
 *   - keydown is a COUNT scalar only (the biometric tripwire, PRIV-04)
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { scoreBehavior } from './beh-score.js';

// A fully human-shaped baseline. Individual tests override single fields.
function humanFeatures(overrides = {}) {
  return {
    mouse_event_rate: 12, // healthy movement
    has_wheel: true,
    wheel_count: 8,
    teleport_click_ratio: 0.05,
    click_count: 6,
    pointer_move_count: 400,
    keydown_count: 20,
    session_ms: 45000,
    click_duration_spread: 35, // varied press durations
    interaction_total: 850,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// automation-signature band
// ---------------------------------------------------------------------------

test('clicks present but mouse_event_rate ~0 → automation-signature', () => {
  const r = scoreBehavior(humanFeatures({
    mouse_event_rate: 0,
    pointer_move_count: 0,
    has_wheel: false,
    wheel_count: 0,
    click_count: 8,
    teleport_click_ratio: 1,
    click_duration_spread: 0,
    interaction_total: 60, // meaningful interaction volume (the clicks + keydowns)
  }));
  assert.equal(r.band, 'automation-signature');
  assert.ok(r.score >= 0.6, `score should be high, got ${r.score}`);
});

test('has_wheel=false with real interaction pushes score up → automation-signature', () => {
  const r = scoreBehavior(humanFeatures({
    has_wheel: false,
    wheel_count: 0,
    mouse_event_rate: 0.4,
    pointer_move_count: 5,
    teleport_click_ratio: 0.8,
    click_count: 5,
    click_duration_spread: 0,
    interaction_total: 90,
  }));
  assert.equal(r.band, 'automation-signature');
});

test('high teleport_click_ratio with clicks present → automation-signature', () => {
  const r = scoreBehavior(humanFeatures({
    teleport_click_ratio: 0.9,
    click_count: 10,
    mouse_event_rate: 0.3,
    pointer_move_count: 8,
    has_wheel: false,
    wheel_count: 0,
    click_duration_spread: 1,
    interaction_total: 120,
  }));
  assert.equal(r.band, 'automation-signature');
});

// ---------------------------------------------------------------------------
// human-shaped band
// ---------------------------------------------------------------------------

test('healthy movement + wheel + low teleport + varied durations → human-shaped', () => {
  const r = scoreBehavior(humanFeatures());
  assert.equal(r.band, 'human-shaped');
  assert.ok(r.score <= 0.4, `score should be low, got ${r.score}`);
});

// ---------------------------------------------------------------------------
// uncertain band — the CRITICAL false-positive guard
// ---------------------------------------------------------------------------

test('near-zero interaction (read-and-left) → uncertain, NOT automation', () => {
  const r = scoreBehavior({
    mouse_event_rate: 0,
    has_wheel: false,
    wheel_count: 0,
    teleport_click_ratio: 0,
    click_count: 0,
    pointer_move_count: 0,
    keydown_count: 0,
    session_ms: 8000,
    click_duration_spread: 0,
    interaction_total: 0,
  });
  assert.equal(r.band, 'uncertain');
  assert.notEqual(r.band, 'automation-signature');
});

test('assistive-tech / keyboard-only nav → uncertain, NEVER automation', () => {
  // keydown_count>0, mouse_event_rate=0, click_count=0, has_wheel=false.
  const r = scoreBehavior({
    mouse_event_rate: 0,
    has_wheel: false,
    wheel_count: 0,
    teleport_click_ratio: 0,
    click_count: 0,
    pointer_move_count: 0,
    keydown_count: 4,
    session_ms: 12000,
    click_duration_spread: 0,
    interaction_total: 4,
  });
  assert.equal(r.band, 'uncertain');
  assert.notEqual(r.band, 'automation-signature');
});

// ---------------------------------------------------------------------------
// biometric line (PRIV-04): keydown is a COUNT scalar only
// ---------------------------------------------------------------------------

test('scoreBehavior output is stable/defined for count-only keydown input', () => {
  // features carry no per-key identity or timing array — only keydown_count.
  const r = scoreBehavior(humanFeatures({ keydown_count: 99 }));
  assert.ok(r && typeof r === 'object');
  assert.equal(typeof r.score, 'number');
  assert.ok(['human-shaped', 'uncertain', 'automation-signature'].includes(r.band));
  // Result must not depend on any per-key structure (none is passed): calling
  // again with the SAME count-only input yields an identical verdict.
  const r2 = scoreBehavior(humanFeatures({ keydown_count: 99 }));
  assert.deepEqual(r, r2);
});

// ---------------------------------------------------------------------------
// robustness + signals
// ---------------------------------------------------------------------------

test('returns a non-empty signals object with component contributions', () => {
  const r = scoreBehavior(humanFeatures());
  assert.ok(r.signals && typeof r.signals === 'object');
  assert.ok(Object.keys(r.signals).length > 0);
});

test('never throws on missing / NaN / garbage input; score clamped 0..1', () => {
  for (const bad of [undefined, null, {}, { mouse_event_rate: NaN }, 'nope', 42]) {
    const r = scoreBehavior(bad);
    assert.ok(r && typeof r.score === 'number');
    assert.ok(r.score >= 0 && r.score <= 1, `score out of range for ${JSON.stringify(bad)}`);
    assert.ok(['human-shaped', 'uncertain', 'automation-signature'].includes(r.band));
  }
});
