/**
 * scripts/lib/__tests__/access.test.js
 *
 * Phase 4.1 Plan 02 (4.1-M04 / D-03). Executable contract for the shared
 * `access` block helpers in scripts/lib/access.js:
 *   - emptyAccess()      spec shape, unknown-first defaults, fresh object per call
 *   - setAccessField()   'group.key' | 'formats' | 'transport' paths + provenance stamp
 *   - accessClarity()    0-1, one-third per known field (auth / cost model / rate limit),
 *                        each third weighted by provenance confidence; `unknown` counts 0;
 *                        notes-only rate limit earns half credit
 *   - mergeAccess()      deep-fill of a partial block onto a base, base untouched
 *
 * Written test-first (D-07): RED with ERR_MODULE_NOT_FOUND until Plan 04
 * creates scripts/lib/access.js.
 *
 * `node --test` only.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAccess, mergeAccess, setAccessField, accessClarity, UNKNOWN } from '../access.js';

test('4.1-M04: emptyAccess returns the spec shape with unknown-first defaults', () => {
  assert.deepEqual(emptyAccess(), {
    cost: { model: 'unknown', free_tier: null, price_notes: null },
    rate_limit: { requests: null, per: null, notes: null, headers_observed: [] },
    auth: { type: 'unknown', signup_url: null },
    license: { spdx: null, name: null, url: null },
    formats: [],
    transport: null,
    provenance: {},
  });
  assert.equal(UNKNOWN, 'unknown');
});

test('4.1-M04: emptyAccess returns a fresh object each call', () => {
  const a = emptyAccess();
  const b = emptyAccess();
  a.formats.push('json');
  assert.deepEqual(b.formats, []);
  assert.notEqual(a, b);
});

test('4.1-M04: setAccessField sets value and stamps provenance exactly', () => {
  const acc = emptyAccess();
  const prov = {
    method: 'spec',
    source_url: 'https://x/openapi.json',
    confidence: 0.9,
    checked_at: '2026-11-02T00:00:00Z',
  };
  const out = setAccessField(acc, 'auth.type', 'bearer', prov);
  assert.equal(out, acc);
  assert.equal(acc.auth.type, 'bearer');
  assert.deepEqual(acc.provenance['auth.type'], prov);
});

test('4.1-M04: setAccessField supports single-segment paths formats and transport', () => {
  const acc = emptyAccess();
  setAccessField(acc, 'formats', ['json', 'csv'], { method: 'declared' });
  assert.deepEqual(acc.formats, ['json', 'csv']);
  setAccessField(acc, 'transport', 'rest');
  assert.equal(acc.transport, 'rest');
  assert.equal(acc.provenance.transport.method, 'manual');
});

test('4.1-M04: setAccessField throws on unknown paths', () => {
  assert.throws(() => setAccessField(emptyAccess(), 'cost.nope', 1), /unknown path/);
  assert.throws(() => setAccessField(emptyAccess(), 'provenance', {}), /unknown path/);
  assert.throws(() => setAccessField(emptyAccess(), 'nope.model', 'free'), /unknown path/);
});

test('4.1-M04: setAccessField defaults provenance (manual, confidence 1, source_url null, ISO checked_at) and clamps confidence', () => {
  const acc = emptyAccess();
  setAccessField(acc, 'cost.model', 'free');
  const p = acc.provenance['cost.model'];
  assert.equal(p.method, 'manual');
  assert.equal(p.confidence, 1);
  assert.equal(p.source_url, null);
  assert.match(p.checked_at, /^\d{4}-\d{2}-\d{2}T/);

  const hi = emptyAccess();
  setAccessField(hi, 'auth.type', 'bearer', { confidence: 7 });
  assert.equal(hi.provenance['auth.type'].confidence, 1);

  const lo = emptyAccess();
  setAccessField(lo, 'auth.type', 'bearer', { confidence: -2 });
  assert.equal(lo.provenance['auth.type'].confidence, 0);
});

test('4.1-M04: accessClarity is 0 for empty/unknown access and for null', () => {
  assert.equal(accessClarity(emptyAccess()), 0);
  assert.equal(accessClarity(null), 0);
  assert.equal(accessClarity(undefined), 0);
});

test('4.1-M04: accessClarity is exactly 1 when auth, cost model and rate limit are known at confidence 1', () => {
  const acc = emptyAccess();
  setAccessField(acc, 'auth.type', 'bearer', { confidence: 1 });
  setAccessField(acc, 'cost.model', 'free', { confidence: 1 });
  acc.rate_limit.per = 'hour';
  setAccessField(acc, 'rate_limit.requests', 5000, { confidence: 1 });
  assert.equal(accessClarity(acc), 1);
});

test('4.1-M04: accessClarity has one-third granularity per known field', () => {
  const authOnly = emptyAccess();
  setAccessField(authOnly, 'auth.type', 'bearer', { confidence: 1 });
  const c1 = accessClarity(authOnly);
  assert.ok(Math.abs(c1 - 1 / 3) < 1e-9, `expected 1/3, got ${c1}`);

  const authAndCost = emptyAccess();
  setAccessField(authAndCost, 'auth.type', 'bearer', { confidence: 1 });
  setAccessField(authAndCost, 'cost.model', 'free', { confidence: 1 });
  const c2 = accessClarity(authAndCost);
  assert.ok(Math.abs(c2 - 2 / 3) < 1e-9, `expected 2/3, got ${c2}`);
});

test('4.1-M04: accessClarity weights each third by provenance confidence', () => {
  const acc = emptyAccess();
  setAccessField(acc, 'auth.type', 'api_key', { confidence: 0.5 });
  const c = accessClarity(acc);
  assert.ok(Math.abs(c - 0.5 / 3) < 1e-9, `expected 0.5/3, got ${c}`);
});

test('4.1-M04: notes-only rate limit earns half credit', () => {
  const notesOnly = emptyAccess();
  notesOnly.rate_limit.notes = '30 calls per minute anonymous';
  notesOnly.provenance['rate_limit.notes'] = {
    method: 'extracted',
    source_url: null,
    confidence: 1,
    checked_at: '2026-11-02T00:00:00Z',
  };
  const half = accessClarity(notesOnly);
  assert.ok(Math.abs(half - 0.5 / 3) < 1e-9, `expected 0.5/3, got ${half}`);

  const structured = emptyAccess();
  structured.rate_limit.notes = '30 calls per minute anonymous';
  structured.rate_limit.per = 'minute';
  setAccessField(structured, 'rate_limit.requests', 30, { confidence: 1 });
  const full = accessClarity(structured);
  assert.ok(Math.abs(full - 1 / 3) < 1e-9, `expected 1/3, got ${full}`);
});

test('4.1-M04: mergeAccess deep-fills a partial access block, normalises provenance, leaves base untouched', () => {
  const base = emptyAccess();
  const merged = mergeAccess(base, {
    auth: { type: 'api_key' },
    license: { name: 'lov2' },
    formats: ['json', 42],
    bogus: { x: 1 },
    provenance: { 'auth.type': { method: 'declared', confidence: 0.8 } },
  });
  assert.equal(merged.auth.type, 'api_key');
  assert.equal(merged.auth.signup_url, null);
  assert.equal(merged.license.name, 'lov2');
  assert.equal(merged.license.spdx, null);
  assert.equal(merged.cost.model, 'unknown');
  assert.deepEqual(merged.formats, ['json']);
  assert.ok(!('bogus' in merged));
  assert.deepEqual(merged.provenance['auth.type'], {
    method: 'declared',
    source_url: null,
    confidence: 0.8,
    checked_at: '',
  });
  assert.deepEqual(base, emptyAccess());
  assert.deepEqual(mergeAccess(emptyAccess(), undefined), emptyAccess());
});
