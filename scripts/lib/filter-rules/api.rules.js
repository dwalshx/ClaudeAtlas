/**
 * scripts/lib/filter-rules/api.rules.js — Phase 4.1 api gates.
 *
 * Per-entity-type gates that apply only to api records. Common gates
 * (fixture denylist, template name, placeholder description, biz-slop)
 * run upstream in index.js's dispatcher.
 *
 * Gates (Phase 4.1 D-06):
 *   - description floor — reject if description < 30 chars. Calibration v1,
 *     2026-11-18; was 50.
 *   - HAS_HOME_URL — reject if home_url is not a non-empty string.
 *   - HAS_BASE_URL_OR_SPEC — reject unless extra.base_urls has >= 1 entry
 *     OR extra.spec_url is a non-empty string.
 *
 * No star gate — Phase 3.1 precedent; api records have no repo
 * (repo_full_name is null for registry/portal origins).
 */

import { hasShortDescription } from './common.rules.js';

/**
 * Calibration v1 (2026-11-18): 50 → 30. The 50-char floor came from the
 * plugin/MCP packs; catalog API descriptions are short by convention ("Stock
 * and Forex Data and Realtime Quotes"). 4.2-CALIBRATION.md Finding 2.
 */
export const MIN_API_DESCRIPTION_LENGTH = 30;
// (A lower floor for spec-backed records was measured and rejected: 20-29
// chars mostly recovered Azure sub-clients and GitHub Enterprise templates.)

/** True when the api description is below the api floor. */
export function hasShortApiDescription(record) {
  return hasShortDescription(record, MIN_API_DESCRIPTION_LENGTH);
}

/**
 * api-specific slop gate.
 *
 * @param {any} record  v2 EntityRecord<ApiExtra>.
 * @returns {boolean} true if the record should be REJECTED.
 */
export function isApiSlop(record) {
  // Defense in depth — no-op if mis-dispatched against a non-api record.
  if (record?.entity_type && record.entity_type !== 'api') return false;

  if (hasShortApiDescription(record)) return true;

  // HAS_HOME_URL
  if (typeof record?.home_url !== 'string' || !record.home_url) return true;

  const e = record?.extra || {};

  // HAS_BASE_URL_OR_SPEC
  const hasBase = Array.isArray(e.base_urls) && e.base_urls.length > 0;
  const hasSpec = typeof e.spec_url === 'string' && e.spec_url.length > 0;
  if (!hasBase && !hasSpec) return true;

  return false;
}
