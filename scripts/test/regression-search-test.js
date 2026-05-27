#!/usr/bin/env node
/**
 * scripts/test/regression-search-test.js — F2 Smoke I.
 *
 * Replays the 20 regression queries captured by T2's
 * scripts/test/capture-regression-fixtures.js against a base URL, then
 * diffs the new top-3 results against the captured fixtures.
 *
 * Pass condition: ≥18/20 queries return identical top-3 slugs vs.
 * the fixture. Per resumed_decisions, tier-filtered queries are allowed
 * to pass with empty-against-empty results (acceptable per
 * pre-F2-baseline-empty-acceptable note) — only non-empty-to-empty
 * regressions FAIL.
 *
 * Usage:
 *   node scripts/test/regression-search-test.js [--base=URL]
 *
 * Default base: from data/regression-queries.json's `base` field.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const FIXTURES_PATH = join(REPO_ROOT, 'data', 'regression-queries.json');

function parseArgs(argv) {
  const opts = { base: null, topN: 3, threshold: 18 };
  for (const a of argv) {
    if (a.startsWith('--base=')) opts.base = a.slice('--base='.length);
    else if (a.startsWith('--topN=')) opts.topN = parseInt(a.slice('--topN='.length), 10) || 3;
    else if (a.startsWith('--threshold=')) opts.threshold = parseInt(a.slice('--threshold='.length), 10) || 18;
  }
  return opts;
}

async function runQuery(base, q, filter_params) {
  const url = new URL('/api/v1/search', base);
  url.searchParams.set('q', q);
  url.searchParams.set('topK', '10');
  for (const [k, v] of Object.entries(filter_params || {})) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    return { error: `HTTP ${res.status}`, results: [] };
  }
  const data = await res.json();
  return { error: null, results: data.results || [] };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(FIXTURES_PATH)) {
    console.error(`[regression-search] ${FIXTURES_PATH} missing — run T2 capture first`);
    process.exit(2);
  }
  const fixtures = JSON.parse(readFileSync(FIXTURES_PATH, 'utf-8'));
  const base = opts.base || fixtures.base || 'https://claudeatlas.com';
  console.log(`[regression-search] base=${base} topN=${opts.topN} threshold=${opts.threshold}/${fixtures.queries.length}`);

  const failures = [];
  const tierFilteredEmptyOK = []; // pre-F2 baseline was empty too — acceptable
  let identical = 0;

  for (const fx of fixtures.queries) {
    const isTierFiltered = fx.filter_params && fx.filter_params.tier;
    const expectedSlugs = fx.top10.slice(0, opts.topN).map((r) => r.slug);
    const expectedEmpty = expectedSlugs.length === 0;

    const { error, results } = await runQuery(base, fx.q, fx.filter_params);
    if (error) {
      failures.push({ q: fx.q, params: fx.filter_params, reason: error });
      continue;
    }
    const actualSlugs = results.slice(0, opts.topN).map((r) => r.slug);
    const actualEmpty = actualSlugs.length === 0;

    if (expectedEmpty && actualEmpty) {
      if (isTierFiltered) {
        tierFilteredEmptyOK.push({ q: fx.q, params: fx.filter_params });
      }
      identical++;
      continue;
    }

    if (expectedEmpty && !actualEmpty) {
      // Per resumed_decisions: "passes either way, fails only on regression non-empty→empty"
      // empty→non-empty is allowed (T8 might fix prior empty results).
      identical++;
      continue;
    }

    if (!expectedEmpty && actualEmpty) {
      failures.push({
        q: fx.q, params: fx.filter_params,
        reason: 'REGRESSION non-empty→empty',
        expected: expectedSlugs,
        actual: actualSlugs,
      });
      continue;
    }

    // Both non-empty — compare slug sets.
    const equal = expectedSlugs.length === actualSlugs.length
      && expectedSlugs.every((s, i) => s === actualSlugs[i]);
    if (equal) {
      identical++;
    } else {
      failures.push({
        q: fx.q, params: fx.filter_params,
        reason: 'top-N differ',
        expected: expectedSlugs,
        actual: actualSlugs,
      });
    }
  }

  const total = fixtures.queries.length;
  console.log(`[regression-search] ${identical}/${total} queries identical (or acceptable per cutover spec)`);
  if (tierFilteredEmptyOK.length > 0) {
    console.log(`  - ${tierFilteredEmptyOK.length} tier-filtered queries empty-against-empty (per pre-F2 baseline acceptance)`);
  }
  if (failures.length > 0) {
    console.error(`[regression-search] ${failures.length} failures:`);
    for (const f of failures) {
      console.error(`  FAIL q=${JSON.stringify(f.q)} params=${JSON.stringify(f.params)}: ${f.reason}`);
      if (f.expected) console.error(`    expected: ${f.expected.join(', ')}`);
      if (f.actual)   console.error(`    actual:   ${f.actual.join(', ')}`);
    }
  }
  if (identical < opts.threshold) {
    console.error(`[regression-search] FAIL — ${identical}/${total} below threshold ${opts.threshold}`);
    process.exit(1);
  }
  console.log(`[regression-search] PASS — ${identical}/${total} ≥ threshold ${opts.threshold}`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[regression-search] EXCEPTION', err);
  process.exit(2);
});
