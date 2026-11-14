/**
 * scripts/lib/scorers/api.scorer.js — Phase 4.1 scorer for
 * entity_type='api' (D-06, UNCALIBRATED).
 *
 * 7 spec signals with spec weights (see feed.signals.js FEED_WEIGHTS).
 * Freshness uses score.js scoreRecency (180-day cliff). Reachability and
 * Popularity read neutral defaults until Phase 4.4 (probe history) and
 * 4.5 (source-normalised percentiles) land; Adoption reads
 * `extra.consumed_by`, populated by the Phase 4.6 consumer graph.
 *
 * SIDE-EFFECT: writes `record.extra.access_clarity` (0-1 float), mirroring
 * the `extra.manifest_completeness` convention in plugin/mcp scorers.
 *
 * Phase 4.2 decision 8: unknown freshness → NEUTRAL_FRESHNESS (50); the
 * frozen APIs.guru snapshot must not be punished as 'stale'. Dataset scorer
 * unchanged.
 */

import { scoreRecency } from '../../score.js';
import { accessClarity } from '../access.js';
import {
  FEED_WEIGHTS,
  NEUTRAL_REACHABILITY,
  NEUTRAL_FRESHNESS,
  scoreFeedDocs,
  scoreFeedLicense,
  feedFreshnessInput,
  scoreFeedPopularity,
  scoreAdoption,
  weightedTotal,
} from './feed.signals.js';

/**
 * Score an api EntityRecord. SIDE-EFFECT: writes record.extra.access_clarity (0-1).
 *
 * @param {any} record  v2 EntityRecord<ApiExtra>.
 * @returns {number} 0-100 integer
 */
export function scoreApi(record) {
  const clarity = accessClarity(record?.access);
  if (record?.extra && typeof record.extra === 'object') record.extra.access_clarity = clarity;
  return weightedTotal(apiSignalScores(record, clarity), FEED_WEIGHTS);
}

/**
 * Per-signal 0-100 scores for an api record — the breakdown behind scoreApi()
 * (Phase 4.3: rendered on /apis/<slug>/ and the methodology page). PURE: no
 * side effects, so pages can call it at build time. weightedTotal(this,
 * FEED_WEIGHTS) === scoreApi(record).
 *
 * @param {any} record  v2 EntityRecord<ApiExtra>.
 * @param {number} [clarity]  precomputed accessClarity(record.access).
 * @returns {{ access: number, reachability: number, docs: number, license: number, freshness: number, popularity: number, adoption: number }}
 */
export function apiSignalScores(record, clarity = accessClarity(record?.access)) {
  const freshnessInput = feedFreshnessInput(record);
  return {
    access: clarity * 100,
    reachability: NEUTRAL_REACHABILITY,          // Phase 4.4 probe history replaces this
    docs: scoreFeedDocs(record),
    license: scoreFeedLicense(record),
    freshness: freshnessInput == null ? NEUTRAL_FRESHNESS : scoreRecency(freshnessInput),   // 180-day cliff; unknown → neutral 50 (4.2 decision 8)
    popularity: scoreFeedPopularity(record),
    adoption: scoreAdoption(record),             // Phase 4.6 consumer graph feeds consumed_by
  };
}
