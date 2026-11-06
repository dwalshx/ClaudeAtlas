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
 */

import { scoreRecency } from '../../score.js';
import { accessClarity } from '../access.js';
import {
  FEED_WEIGHTS,
  NEUTRAL_REACHABILITY,
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
  const scores = {
    access: clarity * 100,
    reachability: NEUTRAL_REACHABILITY,          // Phase 4.4 probe history replaces this
    docs: scoreFeedDocs(record),
    license: scoreFeedLicense(record),
    freshness: scoreRecency(feedFreshnessInput(record)),   // 180-day cliff
    popularity: scoreFeedPopularity(record),
    adoption: scoreAdoption(record),             // Phase 4.6 consumer graph feeds consumed_by
  };
  return weightedTotal(scores, FEED_WEIGHTS);
}
