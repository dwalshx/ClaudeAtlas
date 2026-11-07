/**
 * scripts/lib/feeds/sources/apis-guru.js
 *
 * Phase 4.2 (D-01/D-02, 4.2-M01). Pure parser for the APIs.guru directory
 * (`list.json`, CC0) → raw api records, plus the two spec-pass mutators the
 * harvester applies after fetching each preferred-version OpenAPI document.
 *
 * Decision 8 (frozen snapshot): the hosted directory has not been refreshed
 * since 2023-04, so `versions[v].updated` is not a freshness signal. Dates
 * before FROZEN_CUTOFF are nulled in `extra.source_modified_at` (the api
 * scorer then reads neutral freshness) and kept verbatim in
 * `raw_source.updated` (the harvester's spec-reuse key).
 *
 * Never sets `id` (the harvester assigns ids after the spec pass) and never
 * builds `access` (the harvester runs the access builder).
 */

import { createHash } from 'node:crypto';
import { slugify } from '../text.js';

export const SOURCE = 'apis.guru';
export const LIST_URL = 'https://api.apis.guru/v2/list.json';
export const FROZEN_CUTOFF = '2024-01-01';

const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');

/**
 * Display name: `x-serviceName` when usable (non-empty string, no '.', does
 * not slugify to 'api'), else the first DNS label of the provider.
 *
 * @param {string} key   list.json key, e.g. 'twilio.com:api'
 * @param {any} info     versions[preferred].info
 */
export function apisGuruName(key, info) {
  const provider = info?.['x-providerName'] || String(key).split(':')[0];
  const svc = info?.['x-serviceName'];
  const usable = typeof svc === 'string' && svc !== '' && !svc.includes('.') && slugify(svc) !== 'api';
  return slugify(usable ? svc : provider.split('.')[0]);
}

/**
 * @param {Record<string, any>} list  parsed list.json
 * @param {{ now: string }} opts
 * @returns {any[]} raw api records (entries without versions[preferred] are skipped)
 */
export function parseApisGuruList(list, { now }) {
  const records = [];
  for (const [key, api] of Object.entries(list || {})) {
    const v = api?.versions?.[api?.preferred];
    if (!v) continue;
    const info = v.info || {};
    const provider = info['x-providerName'] || key.split(':')[0];
    const updated = typeof v.updated === 'string' ? v.updated : null;
    const swaggerUrl = v.swaggerUrl ?? null;
    records.push({
      entity_type: 'api',
      name: apisGuruName(key, info),
      description: String(info.description ?? '').trim(),
      origin: { kind: 'registry', source: SOURCE, source_id: key, source_url: swaggerUrl, also_listed_in: [] },
      home_url: info.contact?.url || v.externalDocs?.url || `https://${provider}/`,
      docs_url: v.externalDocs?.url ?? null,
      source: 'registry',
      tags: [],
      scraped_at: now,
      content_sha: sha({ key, updated, swaggerUrl }),
      access: {},
      extra: {
        base_urls: [],
        spec_url: swaggerUrl,
        spec_version: v.openapiVer ?? null,
        endpoint_count: null,
        categories_src: Array.isArray(info['x-apisguru-categories'])
          ? info['x-apisguru-categories'].filter((c) => typeof c === 'string')
          : [],
        provider,
        source_modified_at: updated && updated >= FROZEN_CUTOFF ? updated : null,
        endpoint_summaries: [],
        spec_parsed: false,
      },
      raw_source: {
        shape: 'apis.guru list.json API entry',
        key,
        added: api.added ?? null,
        preferred: api.preferred ?? null,
        updated,
        version_count: Object.keys(api.versions || {}).length,
        x_origin: info['x-origin'] ?? null,
        x_unofficialSpec: Boolean(info['x-unofficialSpec']),
        link: v.link ?? null,
        info_license: info.license ?? null,
        title: info.title ?? null,
      },
    });
  }
  return records;
}

/**
 * Apply an extractOpenApi() result to a raw record (spec pass success).
 * Mutates and returns `rec`; identity fields are untouched.
 */
export function applySpec(rec, ex) {
  rec.extra.base_urls = Array.isArray(ex?.base_urls) ? ex.base_urls : [];
  rec.extra.spec_version = ex?.spec_version ?? rec.extra.spec_version ?? null;
  rec.extra.endpoint_count = Number.isFinite(ex?.endpoint_count) ? ex.endpoint_count : null;
  rec.extra.endpoint_summaries = Array.isArray(ex?.endpoint_summaries) ? ex.endpoint_summaries.slice(0, 10) : [];
  rec.extra.spec_parsed = true;
  if (rec.docs_url == null && ex?.external_docs_url) rec.docs_url = ex.external_docs_url;
  if (rec.raw_source) delete rec.raw_source.spec_skip_reason;
  return rec;
}

/**
 * Mark the spec as not parsed (cap / HTTP error / invalid JSON / catalog-only).
 * Mutates and returns `rec`.
 */
export function markSpecUnparsed(rec, reason) {
  rec.extra.spec_parsed = false;
  rec.extra.base_urls = [];
  rec.extra.endpoint_count = null;
  rec.extra.endpoint_summaries = [];
  rec.raw_source = rec.raw_source || {};
  rec.raw_source.spec_skip_reason = reason;
  return rec;
}
