/**
 * scripts/lib/__tests__/corpus-guards.test.js
 *
 * Pure tests for the fail-fast guards that filter.js, embed-skills.js and
 * scrape.js (full mode) consult before writing. Each case mirrors a concrete
 * state observed during the 2026-09-28 → 2026-11-05 outage.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkRawCorpusNotEmpty,
  checkCatalogCollapse,
  checkFullSweepResult,
  checkEmbedOutput,
} from '../corpus-guards.js';

// --- filter: raw corpus ---

test('raw corpus of 0 records is refused (the 10-18 → 11-03 placeholder cache)', () => {
  const v = checkRawCorpusNotEmpty(0);
  assert.equal(v.ok, false);
  assert.match(v.message, /0 records/);
  assert.match(v.message, /FILTER_ALLOW_EMPTY/);
});

test('raw corpus of 1 record passes; FILTER_ALLOW_EMPTY override passes 0', () => {
  assert.equal(checkRawCorpusNotEmpty(1).ok, true);
  assert.equal(checkRawCorpusNotEmpty(0, { allowEmpty: true }).ok, true);
});

// --- filter: catalog collapse ---

test('catalog 101277 → 0 is a collapse (what filter would have published on 10-18)', () => {
  const v = checkCatalogCollapse({ priorCount: 101277, newCount: 0 });
  assert.equal(v.ok, false);
  assert.match(v.message, /101277 to 0/);
  assert.match(v.message, /FILTER_ALLOW_COLLAPSE/);
});

test('catalog 101277 → 60000 (40.8% drop) passes; → 50000 (50.6%) fails', () => {
  assert.equal(checkCatalogCollapse({ priorCount: 101277, newCount: 60000 }).ok, true);
  assert.equal(checkCatalogCollapse({ priorCount: 101277, newCount: 50000 }).ok, false);
});

test('catalog growth and small priors never trip the collapse guard', () => {
  assert.equal(checkCatalogCollapse({ priorCount: 100000, newCount: 145000 }).ok, true);
  assert.equal(checkCatalogCollapse({ priorCount: 999, newCount: 1 }).ok, true, 'below minPrior');
  assert.equal(checkCatalogCollapse({ priorCount: 0, newCount: 0 }).ok, true, 'cold start');
  assert.equal(checkCatalogCollapse({ priorCount: undefined, newCount: 5 }).ok, true);
});

test('FILTER_ALLOW_COLLAPSE override passes a collapse', () => {
  assert.equal(checkCatalogCollapse({ priorCount: 101277, newCount: 0, allow: true }).ok, true);
});

// --- scrape.js full sweep ---

test('full sweep with 0 results is refused even with no prior stats (the 10-18 weekly wipe)', () => {
  const v = checkFullSweepResult({ prevCount: 0, newCount: 0 });
  assert.equal(v.ok, false);
  assert.match(v.message, /0 skills/);
});

test('full sweep keeps the historical >20% regression rule', () => {
  assert.equal(checkFullSweepResult({ prevCount: 100060, newCount: 85000 }).ok, true, '15% drop ok');
  const v = checkFullSweepResult({ prevCount: 100060, newCount: 70000 });
  assert.equal(v.ok, false);
  assert.match(v.message, /REGRESSION/);
  assert.equal(checkFullSweepResult({ prevCount: 0, newCount: 33000 }).ok, true, 'no prior → any non-zero passes');
});

// --- embed ---

test('embed with 0 input records is refused unless EMBED_ALLOW_EMPTY', () => {
  const v = checkEmbedOutput({ inputCount: 0, outputCount: 0 });
  assert.equal(v.ok, false);
  assert.match(v.message, /0 records/);
  assert.equal(checkEmbedOutput({ inputCount: 0, outputCount: 0, allowEmpty: true }).ok, true);
});

test('embed with input but 0 output is refused; normal delta passes', () => {
  const v = checkEmbedOutput({ inputCount: 100, outputCount: 0 });
  assert.equal(v.ok, false);
  assert.match(v.message, /0 vectors for 100/);
  assert.equal(checkEmbedOutput({ inputCount: 100, outputCount: 100 }).ok, true);
  assert.equal(checkEmbedOutput({ inputCount: 100, outputCount: 1 }).ok, true);
});
