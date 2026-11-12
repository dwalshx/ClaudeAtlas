/**
 * src/lib/feeds.js — Phase 4.2 build-time loader for data-feed entities
 * (api now; dataset in 4.5).
 *
 * Mirrors src/lib/plugins.js load(): streaming readNdjsonRecords, graceful []
 * when the file is absent. Never imports the skills entity loader (it throws
 * at import time without data/skills.ndjson). No pages read this in 4.2 —
 * Phase 4.3 MUST build /apis/ on getApis() / getApiBySlug() from THIS module:
 * D-07 names the skills entity loader, but that loader is skills-only by
 * construction and throws at import without data/skills.ndjson, so api pages
 * must not route through it.
 */

import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNdjsonRecords } from '../../scripts/lib/ndjson.js';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '../../data');

/** Records from `<dir>/apis.ndjson` (header filtered, keyed by id); [] when absent. */
export function loadApisFrom(dir) {
  const p = join(dir, 'apis.ndjson');
  if (!existsSync(p)) return [];
  return [...readNdjsonRecords(p, { keyFn: (r) => r.id }).values()];
}

/**
 * Pure lookup index over a record array. NO is_duplicate filter — direct URLs
 * must resolve duplicates too (entity-loader precedent).
 */
export function makeFeedsIndex(records) {
  const byId = new Map(records.map((r) => [r.id, r]));
  const bySlug = new Map(records.map((r) => [r.slug, r]));
  return {
    getApis: () => records,
    getApiById: (id) => byId.get(id) ?? null,
    getApiBySlug: (slug) => bySlug.get(slug) ?? null,
  };
}

const index = makeFeedsIndex(loadApisFrom(DATA));

export function getApis() { return index.getApis(); }
export function getApiById(id) { return index.getApiById(id); }
export function getApiBySlug(slug) { return index.getApiBySlug(slug); }
