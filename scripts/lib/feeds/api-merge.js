/**
 * scripts/lib/feeds/api-merge.js
 *
 * Phase 4.2 (D-03, 4.2-M05). Pure cross-source merge for raw api records.
 * Runs in filter-apis.js BEFORE upcastRecord. Keys on canonical host + name
 * stem — deliberately NOT the registrable domain (Research Pattern 4: one
 * registrable domain can host hundreds of distinct APIs, e.g. azure.com).
 *
 * Precedence: apis.guru > data.gouv.fr > uk-api-catalogue > public-apis. The
 * winner keeps its identity fields; each loser's source is recorded in
 * origin.also_listed_in and its access fields fill ONLY the winner's unknown
 * ones, carrying the loser's provenance. Inputs are never mutated.
 */

import { slugify } from './text.js';
import { hostOf } from '../url-host.js';

export const SOURCE_PRECEDENCE = ['apis.guru', 'data.gouv.fr', 'uk-api-catalogue', 'public-apis'];
export const STRIP_LABELS = ['www', 'api', 'apis', 'developer', 'developers', 'dev', 'docs', 'open', 'opendata', 'data', 'portal', 'sandbox', 'public'];

/** Lowercased host with ONE leading STRIP_LABELS label removed when ≥ 2 labels remain; '' when unparseable. */
export function canonicalHost(url) {
  const h = hostOf(url).toLowerCase();
  if (!h) return '';
  const labels = h.split('.');
  if (labels.length > 2 && STRIP_LABELS.includes(labels[0])) return labels.slice(1).join('.');
  return h;
}

/** slugify(name) minus ONE leading 'api-' and ONE trailing '-api'; never empty. */
export function nameStem(name) {
  const s = slugify(name);
  const t = s.replace(/^api-/, '').replace(/-api$/, '');
  return t || s;
}

/** `${canonicalHost(base_urls[0] || home_url || docs_url)}/${nameStem(name)}` */
export function mergeKey(rec) {
  const primary = rec?.extra?.base_urls?.[0] || rec?.home_url || rec?.docs_url || '';
  return `${canonicalHost(primary)}/${nameStem(rec?.name ?? '')}`;
}

export const FILL_ACCESS_PATHS = [
  'auth.type', 'auth.schemes', 'cost.model', 'cost.free_tier', 'rate_limit.requests', 'rate_limit.per',
  'rate_limit.notes', 'license.spdx', 'license.name', 'license.url', 'formats', 'transport',
];

const isUnknown = (v) => v == null || v === '' || v === 'unknown' || (Array.isArray(v) && v.length === 0);
const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

function setPath(obj, path, value) {
  const ks = path.split('.');
  let o = obj;
  for (const k of ks.slice(0, -1)) {
    if (!o[k] || typeof o[k] !== 'object') o[k] = {};
    o = o[k];
  }
  o[ks[ks.length - 1]] = value;
}

const rank = (rec) => {
  const i = SOURCE_PRECEDENCE.indexOf(rec?.origin?.source);
  return i === -1 ? SOURCE_PRECEDENCE.length : i;
};

/** Precedence asc, then source_modified_at desc (null last), then source_id asc. */
function cmp(a, b) {
  const r = rank(a) - rank(b);
  if (r) return r;
  const am = a?.extra?.source_modified_at ?? '';
  const bm = b?.extra?.source_modified_at ?? '';
  if (am !== bm) {
    if (am === '') return 1;
    if (bm === '') return -1;
    return am > bm ? -1 : 1;
  }
  const as = String(a?.origin?.source_id ?? '');
  const bs = String(b?.origin?.source_id ?? '');
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function absorb(winner, loser) {
  const ws = winner.origin.source;
  const ls = loser?.origin?.source;
  if (!Array.isArray(winner.origin.also_listed_in)) winner.origin.also_listed_in = [];
  if (ls && ls !== ws && !winner.origin.also_listed_in.includes(ls)) winner.origin.also_listed_in.push(ls);

  if (!winner.access || typeof winner.access !== 'object') winner.access = {};
  if (!winner.access.provenance || typeof winner.access.provenance !== 'object') winner.access.provenance = {};
  for (const path of FILL_ACCESS_PATHS) {
    const wv = getPath(winner.access, path);
    const lv = getPath(loser?.access, path);
    if (isUnknown(wv) && !isUnknown(lv)) {
      setPath(winner.access, path, structuredClone(lv));
      const p = loser?.access?.provenance?.[path];
      if (p) winner.access.provenance[path] = structuredClone(p);
    }
  }

  if (winner.docs_url == null && loser?.docs_url) winner.docs_url = loser.docs_url;
  if (winner.extra.spec_url == null && loser?.extra?.spec_url) winner.extra.spec_url = loser.extra.spec_url;
  // Decision 6: fill the description only when the winner's is EMPTY (no padding).
  if ((winner.description ?? '') === '' && typeof loser?.description === 'string' && loser.description) {
    winner.description = loser.description;
  }
  const cats = new Set(winner.extra.categories_src || []);
  for (const c of loser?.extra?.categories_src || []) cats.add(c);
  winner.extra.categories_src = [...cats];
}

/**
 * @param {any[]} records  raw api records
 * @returns {{ merged: any[], stats: { groups: number, merged_duplicates: { cross_source: number, same_source: number } } }}
 */
export function mergeApiRecords(records) {
  const groups = new Map();
  for (const r of records || []) {
    const k = mergeKey(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  }
  const merged = [];
  let cross = 0;
  let same = 0;
  for (const group of groups.values()) {
    const sorted = [...group].sort(cmp);
    const winner = structuredClone(sorted[0]);
    for (const loser of sorted.slice(1)) {
      if (loser?.origin?.source === winner.origin.source) same++;
      else cross++;
      absorb(winner, loser);
    }
    merged.push(winner);
  }
  return { merged, stats: { groups: groups.size, merged_duplicates: { cross_source: cross, same_source: same } } };
}
