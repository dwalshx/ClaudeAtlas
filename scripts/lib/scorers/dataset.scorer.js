/**
 * scripts/lib/scorers/dataset.scorer.js — Phase 4.1 scorer for
 * entity_type='dataset' (D-06, UNCALIBRATED).
 *
 * Identical shape to api.scorer.js EXCEPT Freshness uses
 * scoreDatasetFreshness (365-day cliff — datasets are refreshed far less
 * often than API specs). Documentation reads `extra.schema_url` (Croissant /
 * DCAT) as the spec-equivalent via scoreFeedDocs.
 *
 * Source popularity metrics (`extra.popularity` downloads/views/likes/
 * citations) are COLLECTED but NOT scored in 4.1 — source-normalised
 * percentiles are Phase 4.5. Popularity reads GitHub stars when a repo is
 * known, else neutral 50.
 *
 * SIDE-EFFECT: writes `record.extra.access_clarity` (0-1 float).
 */

import { accessClarity } from '../access.js';
import {
  FEED_WEIGHTS,
  NEUTRAL_REACHABILITY,
  scoreFeedDocs,
  scoreFeedLicense,
  scoreDatasetFreshness,
  feedFreshnessInput,
  scoreFeedPopularity,
  scoreAdoption,
  weightedTotal,
} from './feed.signals.js';

/**
 * Score a dataset EntityRecord. SIDE-EFFECT: writes record.extra.access_clarity (0-1).
 *
 * @param {any} record  v2 EntityRecord<DatasetExtra>.
 * @returns {number} 0-100 integer
 */
export function scoreDataset(record) {
  const clarity = accessClarity(record?.access);
  if (record?.extra && typeof record.extra === 'object') record.extra.access_clarity = clarity;
  const scores = {
    access: clarity * 100,
    reachability: NEUTRAL_REACHABILITY,          // Phase 4.4 probe history replaces this
    docs: scoreFeedDocs(record),
    license: scoreFeedLicense(record),
    freshness: scoreDatasetFreshness(feedFreshnessInput(record)),   // 365-day cliff
    popularity: scoreFeedPopularity(record),     // Phase 4.5 source-normalised percentiles replace this
    adoption: scoreAdoption(record),             // Phase 4.6 consumer graph feeds consumed_by
  };
  return weightedTotal(scores, FEED_WEIGHTS);
}
