/**
 * scripts/lib/feeds/sources/public-apis.js
 *
 * Phase 4.2 (D-01, 4.2-M01). Pure parser for the marcelscruz/public-apis
 * mirror (`db/resources.json`, MIT) → raw api records. Coarse Auth / Cors /
 * Link / Category only.
 *
 * Decision 2: `extra.base_urls = [Link]` — the Link is usually a docs page,
 * not a verified base URL; the access builder marks it `declared` at
 * confidence 0.5 so later ladder steps can overwrite it.
 */

import { createHash } from 'node:crypto';
import { slugify } from '../text.js';
import { hostOf } from '../../url-host.js';

export const SOURCE = 'public-apis';
export const RESOURCES_URL = 'https://raw.githubusercontent.com/marcelscruz/public-apis/main/db/resources.json';

const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');

/**
 * @param {{ entries?: any[] }} json  parsed resources.json
 * @param {{ now: string }} opts
 * @returns {any[]} raw api records (entries without a string `API` are skipped)
 */
export function parsePublicApis(json, { now }) {
  const records = [];
  for (const e of json?.entries ?? []) {
    if (!e || typeof e.API !== 'string' || !e.API) continue;
    const link = typeof e.Link === 'string' ? e.Link : null;
    records.push({
      entity_type: 'api',
      name: slugify(e.API),
      description: String(e.Description ?? '').trim(),
      origin: { kind: 'registry', source: SOURCE, source_id: e.API, source_url: RESOURCES_URL, also_listed_in: [] },
      home_url: link ?? '',
      docs_url: null,
      source: 'registry',
      tags: [],
      scraped_at: now,
      content_sha: sha({ API: e.API, Link: link }),
      access: {},
      extra: {
        base_urls: e.Link ? [e.Link] : [],
        spec_url: null,
        spec_version: null,
        endpoint_count: null,
        categories_src: typeof e.Category === 'string' && e.Category ? [e.Category] : [],
        provider: hostOf(link).replace(/^www\./, '') || SOURCE,
        source_modified_at: null,
        endpoint_summaries: [],
        spec_parsed: false,
      },
      raw_source: {
        shape: 'public-apis db/resources.json entries[i]',
        API: e.API,
        Description: e.Description ?? null,
        Auth: e.Auth ?? null,
        Cors: e.Cors ?? null,
        Link: link,
        Category: e.Category ?? null,
      },
    });
  }
  return records;
}
