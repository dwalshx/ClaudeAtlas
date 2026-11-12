/**
 * scripts/lib/feeds/sources/uk-catalogue.js
 *
 * Phase 4.2 (D-01, 4.2-M01). Pure parser for the UK government API catalogue
 * (co-cddo/api-catalogue `data/catalogue.csv`, OGL v3) → raw api records.
 *
 * The CSV has quoted fields with REAL embedded newlines (one record spans
 * several physical lines), so it goes through a small RFC 4180 state
 * machine — never a line split. No csv-parse dependency.
 */

import { createHash } from 'node:crypto';
import { slugify } from '../text.js';
import { hostOf } from '../../url-host.js';

export const SOURCE = 'uk-api-catalogue';
export const CSV_URL = 'https://raw.githubusercontent.com/co-cddo/api-catalogue/main/data/catalogue.csv';

const sha = (o) => createHash('sha256').update(JSON.stringify(o)).digest('hex');

/**
 * RFC 4180: quoted fields may contain ',', '\n' and '""' (escaped quote);
 * '\r' is ignored; a leading BOM is stripped defensively.
 *
 * @param {string} text
 * @returns {string[][]} rows (row 0 = header)
 */
export function parseCsv(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQ) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * @param {string} text  catalogue.csv body
 * @param {{ now: string }} opts
 * @returns {any[]} raw api records (rows with an empty name are skipped)
 */
export function parseUkCatalogue(text, { now }) {
  const rows = parseCsv(text);
  const header = rows[0] || [];
  const records = [];
  for (const cells of rows.slice(1)) {
    if (!cells.length || cells.every((c) => c === '')) continue;
    const row = Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    if (!row.name) continue;
    const url = row.url ?? '';
    const documentation = row.documentation ?? '';
    const dateUpdated = row.dateUpdated ?? '';
    records.push({
      entity_type: 'api',
      name: slugify(row.name),
      description: String(row.description ?? '').trim(),
      origin: {
        kind: 'registry',
        source: SOURCE,
        source_id: url || row.name,
        source_url: `${CSV_URL}#${encodeURIComponent(row.name)}`,
        also_listed_in: [],
      },
      home_url: url || documentation || '',
      docs_url: documentation || null,
      source: 'registry',
      tags: [],
      scraped_at: now,
      content_sha: sha({ url, name: row.name, dateUpdated }),
      access: {},
      extra: {
        base_urls: hostOf(url) ? [url] : [],
        spec_url: null,
        spec_version: null,
        endpoint_count: null,
        categories_src: [],
        provider: row.provider || SOURCE,
        source_modified_at: /^\d{4}-\d{2}-\d{2}$/.test(dateUpdated) ? `${dateUpdated}T00:00:00Z` : null,
        endpoint_summaries: [],
        spec_parsed: false,
      },
      raw_source: {
        shape: 'co-cddo api-catalogue catalogue.csv row',
        dateAdded: row.dateAdded ?? '',
        dateUpdated,
        url,
        name: row.name,
        description: row.description ?? '',
        documentation,
        license: row.license ?? '',
        maintainer: row.maintainer ?? '',
        areaServed: row.areaServed ?? '',
        startDate: row.startDate ?? '',
        endDate: row.endDate ?? '',
        provider: row.provider ?? '',
      },
    });
  }
  return records;
}
