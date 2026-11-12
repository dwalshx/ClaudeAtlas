/**
 * scripts/lib/filter-rules/dataset.rules.js — Phase 4.1 dataset gates.
 *
 * Per-entity-type gates that apply only to dataset records. Common gates
 * (fixture denylist, template name, placeholder description, biz-slop)
 * run upstream in index.js's dispatcher.
 *
 * Gates (Phase 4.1 D-06):
 *   - MIN_DESCRIPTION_LENGTH — reject if description < 50 chars.
 *   - HAS_HOME_URL — reject if home_url is not a non-empty string.
 *   - HAS_DOWNLOAD_OR_LANDING — reject unless extra.download_urls has >= 1
 *     entry OR home_url is a non-empty string. A landing page alone PASSES
 *     (many portal datasets expose files only behind the landing page).
 *
 * No star gate — Phase 3.1 precedent; dataset records have no repo
 * (repo_full_name is null for registry/portal origins).
 */

import { hasShortDescription } from './common.rules.js';

/** Per Phase 4.1 D-06 (shared with the plugin/mcp packs). */
const MIN_DESCRIPTION_LENGTH = 50;

/**
 * dataset-specific slop gate.
 *
 * @param {any} record  v2 EntityRecord<DatasetExtra>.
 * @returns {boolean} true if the record should be REJECTED.
 */
export function isDatasetSlop(record) {
  // Defense in depth — no-op if mis-dispatched against a non-dataset record.
  if (record?.entity_type && record.entity_type !== 'dataset') return false;

  if (hasShortDescription(record, MIN_DESCRIPTION_LENGTH)) return true;

  // HAS_HOME_URL
  if (typeof record?.home_url !== 'string' || !record.home_url) return true;

  const e = record?.extra || {};

  // HAS_DOWNLOAD_OR_LANDING
  // With HAS_HOME_URL already enforced this gate only matters if HAS_HOME_URL
  // is ever relaxed; kept for parity with D-06 wording. A landing page alone
  // PASSES.
  const hasDownload = Array.isArray(e.download_urls) && e.download_urls.length >= 1;
  const hasLanding = typeof record.home_url === 'string' && record.home_url.length > 0;
  if (!hasDownload && !hasLanding) return true;

  return false;
}
