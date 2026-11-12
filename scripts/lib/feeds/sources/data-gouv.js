/**
 * scripts/lib/feeds/sources/data-gouv.js
 *
 * Phase 4.2 (D-01, 4.2-M01). Pure parser for one page of the data.gouv.fr
 * dataservices API (`/api/1/dataservices/`, Licence Ouverte 2.0) → raw api
 * records. The harvester follows `next_page` via nextPageUrl().
 *
 * Every declared access field the access builder needs (rate_limiting,
 * access_type, license, ...) is copied into `raw_source`. Decision 7:
 * `machine_documentation_url` becomes `extra.spec_url` but is never fetched
 * in 4.2. Owner-only records (no organization) take the owner slug as
 * provider.
 */

import { createHash } from 'node:crypto';
import { slugify } from '../text.js';

export const SOURCE = 'data.gouv.fr';
export const FIRST_PAGE_URL = 'https://www.data.gouv.fr/api/1/dataservices/?page_size=200';

const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');

/** @returns {string | null} */
export function nextPageUrl(page) {
  return typeof page?.next_page === 'string' ? page.next_page : null;
}

/** slugify(title) with ONE leading 'api-' stripped; falls back to slugify(title). */
export function dataGouvName(title) {
  const s = slugify(title);
  const t = s.replace(/^api-/, '');
  return t || s;
}

/**
 * @param {{ data?: any[] }} page  parsed dataservices page
 * @param {{ now: string }} opts
 * @returns {any[]} raw api records (archived / deleted / private items skipped)
 */
export function parseDataGouvPage(page, { now }) {
  const records = [];
  for (const item of page?.data ?? []) {
    if (!item || item.archived_at || item.deleted_at || item.private === true) continue;
    records.push({
      entity_type: 'api',
      name: dataGouvName(item.title ?? ''),
      description: String(item.description ?? '').trim(),
      origin: {
        kind: 'portal',
        source: SOURCE,
        source_id: item.slug ?? item.id ?? null,
        source_url: item.self_api_url ?? null,
        also_listed_in: [],
      },
      home_url: item.self_web_url ?? '',
      docs_url: item.technical_documentation_url ?? item.business_documentation_url ?? null,
      source: 'registry',
      tags: [],
      scraped_at: now,
      content_sha: sha({ slug: item.slug ?? null, metadata_modified_at: item.metadata_modified_at ?? null }),
      access: {},
      extra: {
        base_urls: item.base_api_url ? [item.base_api_url] : [],
        spec_url: item.machine_documentation_url ?? null,
        spec_version: null,
        endpoint_count: null,
        categories_src: Array.isArray(item.tags) ? item.tags.filter((t) => typeof t === 'string') : [],
        provider: item.organization?.slug ?? item.owner?.slug ?? SOURCE,
        source_modified_at: item.metadata_modified_at ?? null,
        endpoint_summaries: [],
        spec_parsed: false,
      },
      raw_source: {
        shape: 'data.gouv.fr /api/1/dataservices/ data[i]',
        title: item.title ?? null,
        slug: item.slug ?? null,
        access_type: item.access_type ?? null,
        access_type_reason: item.access_type_reason ?? null,
        rate_limiting: item.rate_limiting ?? null,
        rate_limiting_url: item.rate_limiting_url ?? null,
        availability: item.availability ?? null,
        license: item.license ?? null,
        authorization_request_url: item.authorization_request_url ?? null,
        base_api_url: item.base_api_url ?? null,
        machine_documentation_url: item.machine_documentation_url ?? null,
        technical_documentation_url: item.technical_documentation_url ?? null,
        business_documentation_url: item.business_documentation_url ?? null,
        format: item.format ?? null,
        metrics: {
          views: item.metrics?.views ?? null,
          followers: item.metrics?.followers ?? null,
          reuses: item.metrics?.reuses ?? null,
        },
        quality_score: item.quality?.score ?? null,
        organization: item.organization
          ? { name: item.organization.name ?? null, slug: item.organization.slug ?? null, acronym: item.organization.acronym ?? null }
          : null,
        owner: item.owner ? { slug: item.owner.slug ?? null } : null,
        metadata_modified_at: item.metadata_modified_at ?? null,
      },
    });
  }
  return records;
}
