/**
 * scripts/lib/filter-rules/api.rules.js — Phase 4.1 api gates.
 *
 * Per-entity-type gates that apply only to api records. Common gates
 * (fixture denylist, template name, placeholder description, biz-slop)
 * run upstream in index.js's dispatcher.
 *
 * Gates (Phase 4.1 D-06):
 *   - MIN_DESCRIPTION_LENGTH — reject if description < 50 chars.
 *   - HAS_HOME_URL — reject if home_url is not a non-empty string.
 *   - HAS_BASE_URL_OR_SPEC — reject unless extra.base_urls has >= 1 entry
 *     OR extra.spec_url is a non-empty string.
 *
 * No star gate — Phase 3.1 precedent; api records have no repo
 * (repo_full_name is null for registry/portal origins).
 */

import { hasShortDescription } from './common.rules.js';

/** Per Phase 4.1 D-06 (shared with the plugin/mcp packs). */
const MIN_DESCRIPTION_LENGTH = 50;

/**
 * api-specific slop gate.
 *
 * @param {any} record  v2 EntityRecord<ApiExtra>.
 * @returns {boolean} true if the record should be REJECTED.
 */
export function isApiSlop(record) {
  // Defense in depth — no-op if mis-dispatched against a non-api record.
  if (record?.entity_type && record.entity_type !== 'api') return false;

  if (hasShortDescription(record, MIN_DESCRIPTION_LENGTH)) return true;

  // HAS_HOME_URL
  if (typeof record?.home_url !== 'string' || !record.home_url) return true;

  const e = record?.extra || {};

  // HAS_BASE_URL_OR_SPEC
  const hasBase = Array.isArray(e.base_urls) && e.base_urls.length > 0;
  const hasSpec = typeof e.spec_url === 'string' && e.spec_url.length > 0;
  if (!hasBase && !hasSpec) return true;

  return false;
}
