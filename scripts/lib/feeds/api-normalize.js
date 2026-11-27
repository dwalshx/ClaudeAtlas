/**
 * scripts/lib/feeds/api-normalize.js — API calibration v1 (2026-11-18).
 *
 * Pure, filter-stage clean-up of RAW api records, applied by filter-apis.js
 * before the cross-source merge. It runs on every filter pass, so it also
 * corrects raw records the harvester carries over unchanged on a 304 (a
 * harvester-only fix would not reach those until the source changes).
 *
 *   - cleanDescription(): literal "\n" sequences (UK catalogue CSV), markdown
 *     backslash escapes ("\:" in data.gouv.fr text) and <https://…> autolinks.
 *   - rawApiTitle(): the human title each catalog carries (APIs.guru
 *     info.title, data.gouv.fr title, UK name, public-apis API). Stored as
 *     extra.title; record.name stays the slug-shaped id/slug input.
 *   - migratePublicApisCost(): public-apis is a list of APIs with free access
 *     or a free tier, not of free APIs (Stripe and OpenAI are on it). Raw
 *     records harvested before this change declare cost.model 'free'; they
 *     become cost unknown + a free_tier note (heuristic). The harvester now
 *     writes that shape directly (api-access.js).
 */

import { PUBLIC_APIS_FREE_TIER_NOTE } from './api-access.js';

const MD_ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!:|>~<"'=])/g;

/**
 * Display clean-up for catalog description text. Idempotent.
 * @param {unknown} s
 * @returns {string}
 */
export function cleanDescription(s) {
  if (typeof s !== 'string' || !s) return '';
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\\r\\n|\\n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(MD_ESCAPABLE, '$1')
    .replace(/<((?:https?|mailto):[^\s<>]+)>/gi, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Where each source keeps its human title inside raw_source. */
const TITLE_KEYS = {
  'apis.guru': 'title',
  'data.gouv.fr': 'title',
  'uk-api-catalogue': 'name',
  'public-apis': 'API',
};

/**
 * The catalog's own display title, or null.
 * @param {any} rec raw api record (with raw_source)
 * @returns {string | null}
 */
export function rawApiTitle(rec) {
  const key = TITLE_KEYS[rec?.origin?.source];
  const v = key ? rec?.raw_source?.[key] : null;
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t || null;
}

/**
 * Rewrite a pre-2026-11-18 public-apis `cost.model: 'free'` (declared) into
 * cost unknown + a heuristic free_tier note. Mutates and returns `access`.
 * No-op for other sources or already-migrated records.
 */
export function migratePublicApisCost(rec) {
  const a = rec?.access;
  if (rec?.origin?.source !== 'public-apis' || !a?.cost) return a;
  const prov = a.provenance || {};
  if (a.cost.model === 'free' && prov['cost.model']?.method === 'declared') {
    const checkedAt = prov['cost.model'].checked_at ?? null;
    const sourceUrl = prov['cost.model'].source_url ?? null;
    a.cost.model = 'unknown';
    delete prov['cost.model'];
    if (!a.cost.free_tier) {
      a.cost.free_tier = PUBLIC_APIS_FREE_TIER_NOTE;
      prov['cost.free_tier'] = { method: 'heuristic', source_url: sourceUrl, confidence: 0.5, checked_at: checkedAt };
    }
    a.provenance = prov;
  }
  return a;
}

/**
 * Apply all raw-record clean-ups. Returns a NEW record (shallow copies of the
 * touched objects); the input is not mutated.
 * @param {any} rec
 */
export function normalizeRawApi(rec) {
  if (!rec || typeof rec !== 'object') return rec;
  const out = { ...rec, extra: { ...(rec.extra || {}) } };
  if (rec.access) out.access = structuredClone(rec.access);
  out.description = cleanDescription(rec.description);
  const title = rawApiTitle(rec);
  if (title) out.extra.title = title;
  migratePublicApisCost(out);
  return out;
}
