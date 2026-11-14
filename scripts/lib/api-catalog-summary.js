/**
 * scripts/lib/api-catalog-summary.js — Phase 4.3 agent-surface helper.
 *
 * One answer to "does this build ship api records, and how many?" for the
 * build-time generators that describe the catalog (generate-llms-txt.js,
 * generate-registry.js). The answer comes from data/apis.ndjson itself — the
 * same file the /apis/ pages are built from (src/lib/feeds.js) — so the agent
 * surfaces never advertise API pages a build did not render. The file is
 * absent whenever DATA_FEEDS_ENABLED is off (or the push-event `apis-latest`
 * fetch failed); every caller treats `null` as "emit no api content".
 */

import { existsSync } from 'node:fs';
import { readNdjsonRecords } from './ndjson.js';

const SITE_URL = 'https://claudeatlas.com';

export const APIS_INDEX_URL = `${SITE_URL}/apis/`;
export const APIS_DETAIL_URL_TEMPLATE = `${SITE_URL}/apis/{slug}/`;
export const APIS_SEARCH_URL = `${SITE_URL}/api/v1/search?type=api`;
export const APIS_METHODOLOGY_URL = `${SITE_URL}/methodology/#data-feed-scoring`;
export const APIS_BULK_DOWNLOAD_URL =
  'https://github.com/dwalshx/ClaudeAtlas/releases/download/apis-latest/apis.ndjson';

/**
 * @param {string | null | undefined} apisPath  path to apis.ndjson
 * @returns {{ count: number, tiers: { featured: number, solid: number, listed: number } } | null}
 *   null when the file is absent, unreadable, or holds no api records.
 */
export function summarizeApiCatalog(apisPath) {
  if (!apisPath || !existsSync(apisPath)) return null;
  let recs;
  try {
    recs = readNdjsonRecords(apisPath, { keyFn: (r) => r.id });
  } catch {
    return null;
  }
  const tiers = { featured: 0, solid: 0, listed: 0 };
  let count = 0;
  for (const r of recs.values()) {
    if (!r || r.entity_type !== 'api') continue;
    count++;
    if (r.quality_tier in tiers) tiers[r.quality_tier]++;
  }
  return count > 0 ? { count, tiers } : null;
}
