/**
 * scripts/lib/scorers/feed.signals.js — Phase 4.1 / D-06 — shared
 * sub-signals for the api + dataset scorers.
 *
 * UNCALIBRATED: weights are the spec table verbatim
 * (docs/PHASE-4.0-SPEC.md § "Scoring — 7 signals"); calibration against
 * real harvests is 4.2 (api) and 4.5 (dataset). Do not tune here.
 *
 * Freshness: api records with no `source_modified_at` and no `repo_pushed_at`
 * score NEUTRAL 50 (Phase 4.2 decision 8 — APIs.guru's hosted directory is a
 * frozen 2023-04 snapshot; `harvest-apis.js` nulls any `updated` before
 * 2024-01-01 and keeps the raw date in `raw_source.updated`, so 'unknown'
 * means 'the source cannot tell us', not 'stale'). Dataset records keep
 * unknown → 0 (orchestrator decision 5 of 4.1) until Phase 4.5 calibrates.
 *
 * Reachability (no probe history until 4.4) and Popularity (no
 * source-normalised percentiles until 4.5; GitHub stars used when a repo is
 * known) read neutral defaults so the scorer is total on day one.
 */

import { scoreStars, scoreLicense, scoreDescription } from '../../score.js';

/** Spec weights, verbatim. Sum = 1.00. */
export const FEED_WEIGHTS = Object.freeze({ access: 0.20, reachability: 0.15, docs: 0.15, license: 0.15, freshness: 0.15, popularity: 0.15, adoption: 0.05 });

export const NEUTRAL_REACHABILITY = 70;   // spec: "starts neutral at 0.7 until 7 days of history"
export const NEUTRAL_POPULARITY = 50;
export const NEUTRAL_FRESHNESS = 50;   // Phase 4.2 decision 8 — api ONLY (see api.scorer.js); dataset keeps unknown → 0 until 4.5 decides

/**
 * Documentation signal, 0-100:
 * docs_url present 40 + machine-readable spec/schema present 40 +
 * description quality 0-20.
 *
 * @param {any} record  v2 EntityRecord<ApiExtra | DatasetExtra>.
 * @returns {number}
 */
export function scoreFeedDocs(record) {
  const e = record?.extra || {};
  let s = 0;
  if (typeof record?.docs_url === 'string' && record.docs_url) s += 40;
  if ((typeof e.spec_url === 'string' && e.spec_url) || (typeof e.schema_url === 'string' && e.schema_url)) s += 40;
  s += scoreDescription(record?.description || '') * 0.2;
  return Math.min(100, s);
}

/**
 * License signal: declared-any 70 / permissive 100 / undeclared 0.
 * scoreLicense's existing ladder IS the spec's three steps.
 *
 * @param {any} record
 * @returns {number}
 */
export function scoreFeedLicense(record) {
  const l = record?.access?.license || {};
  return scoreLicense(l.spdx ?? l.name ?? null);
}

/**
 * Dataset Freshness: 365-day cliff (api uses score.js scoreRecency, 180-day cliff).
 *
 * @param {string | null | undefined} iso
 * @returns {number} 0-100
 */
export function scoreDatasetFreshness(iso) {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  const days = (Date.now() - t) / 86400000;
  if (days <= 30) return 100;
  if (days <= 90) return 90;
  if (days <= 180) return 75;
  if (days <= 365) return 50;
  if (days <= 730) return 25;
  return 5;
}

/**
 * Freshness input: source `modified` first, GitHub push date as fallback
 * when a repo is known, else null (api → NEUTRAL_FRESHNESS; dataset → 0).
 *
 * @param {any} record
 * @returns {string | null}
 */
export function feedFreshnessInput(record) {
  return record?.extra?.source_modified_at ?? record?.repo_pushed_at ?? null;
}

/**
 * Popularity: GitHub stars when a repo is known, else neutral 50.
 * Source-normalised download/view percentiles are Phase 4.5.
 *
 * @param {any} record
 * @returns {number}
 */
export function scoreFeedPopularity(record) {
  return typeof record?.repo_stars === 'number' ? scoreStars(record.repo_stars) : NEUTRAL_POPULARITY;
}

/**
 * Ecosystem adoption: 20 points per consumer, saturating at 5.
 * `extra.consumed_by` is populated by the Phase 4.6 consumer graph.
 *
 * @param {any} record
 * @returns {number}
 */
export function scoreAdoption(record) {
  const cb = record?.extra?.consumed_by || {};
  const n = (cb.skills?.length || 0) + (cb.plugins?.length || 0) + (cb.mcp_servers?.length || 0);
  return Math.min(100, n * 20);
}

/**
 * Weighted sum → clamped 0-100 integer (same shape as the skill/plugin/mcp scorers).
 *
 * @param {Record<string, number>} scores
 * @param {Record<string, number>} weights
 * @returns {number}
 */
export function weightedTotal(scores, weights) {
  let t = 0;
  for (const [k, w] of Object.entries(weights)) t += (scores[k] || 0) * w;
  return Math.round(Math.min(100, Math.max(0, t)));
}
