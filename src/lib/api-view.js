/**
 * src/lib/api-view.js — Phase 4.3 pure presentation helpers for api
 * EntityRecords (/apis/ index + /apis/<slug>/ detail pages).
 *
 * Every helper is null-safe: api records come from four catalogs with very
 * different field coverage, and `unknown` is first-class (spec: "unknown is
 * explicit"). No I/O here — loaders live in src/lib/feeds.js.
 */

import { apiSignalScores } from '../../scripts/lib/scorers/api.scorer.js';
import { FEED_WEIGHTS } from '../../scripts/lib/scorers/feed.signals.js';

const COST_LABELS = {
  free: 'Free',
  freemium: 'Free tier + paid',
  paid: 'Paid',
  pay_per_call: 'Pay per call',
};

const AUTH_LABELS = {
  none: 'No auth',
  api_key: 'API key',
  bearer: 'Bearer token',
  oauth2: 'OAuth 2.0',
  http_basic: 'HTTP Basic',
  openid: 'OpenID Connect',
};

const SOURCE_LABELS = {
  'apis.guru': 'APIs.guru',
  'data.gouv.fr': 'data.gouv.fr',
  'uk-api-catalogue': 'UK API Catalogue',
  'public-apis': 'public-apis',
};

/** How each provenance method is described on the page (legend + chip tooltip). */
export const PROVENANCE_LABELS = Object.freeze({
  declared: 'Declared by the source catalog',
  spec: 'Read from the OpenAPI spec',
  probed: 'Observed by our probe',
  heuristic: 'Inferred heuristically',
  extracted: 'Extracted from docs',
  manual: 'Verified manually',
});

/** Signal display order + labels for the score breakdown (weights from FEED_WEIGHTS). */
export const SIGNAL_LABELS = Object.freeze([
  ['access', 'Access clarity'],
  ['reachability', 'Reachability'],
  ['docs', 'Documentation'],
  ['license', 'License'],
  ['freshness', 'Freshness'],
  ['popularity', 'Popularity'],
  ['adoption', 'Adoption'],
]);

/** Signals that are neutral placeholders until a later phase lands. */
export const PLACEHOLDER_SIGNALS = Object.freeze({
  reachability: 'Neutral until the Phase 4.4 reachability probe has history',
  popularity: 'Neutral until source-normalised popularity lands',
  adoption: 'Filled by the consumer graph (skills/MCPs that call this API)',
});

export function sourceLabel(source) {
  if (!source) return 'Unknown source';
  return SOURCE_LABELS[source] || source;
}

/** "Free", "API key", … or null when unknown (caller renders "Unknown"). */
export function costLabel(access) {
  const m = access?.cost?.model;
  return (m && COST_LABELS[m]) || null;
}

export function authLabel(access) {
  const t = access?.auth?.type;
  return (t && AUTH_LABELS[t]) || null;
}

/** "100 requests / minute", a free-text note, or null. */
export function rateLimitLabel(access) {
  const rl = access?.rate_limit;
  if (!rl) return null;
  if (Number.isFinite(rl.requests) && rl.per) {
    return `${rl.requests.toLocaleString('en-US')} requests / ${rl.per}`;
  }
  if (rl.notes && String(rl.notes).trim()) return String(rl.notes).trim().slice(0, 140);
  return null;
}

export function licenseLabel(access) {
  const l = access?.license;
  if (!l) return null;
  return l.spdx || l.name || null;
}

/**
 * Provenance chip for one access field, or null when the field has none.
 * `path` is the provenance key ('auth.type', 'cost.model', 'rate_limit', …).
 * Rate-limit provenance may be keyed by any rate_limit.* sub-path, so a
 * prefix match is accepted.
 */
export function provenanceFor(access, path) {
  const prov = access?.provenance;
  if (!prov || typeof prov !== 'object') return null;
  let entry = prov[path];
  if (!entry) {
    const key = Object.keys(prov).find((k) => k === path || k.startsWith(`${path}.`));
    entry = key ? prov[key] : null;
  }
  if (!entry || !entry.method) return null;
  const confidence = Number.isFinite(entry.confidence) ? entry.confidence : null;
  return {
    method: entry.method,
    label: PROVENANCE_LABELS[entry.method] || entry.method,
    confidence,
    confidencePct: confidence == null ? null : Math.round(confidence * 100),
    sourceUrl: entry.source_url || null,
  };
}

/**
 * The five access-card rows, in display order. `value` null ⇒ render
 * "Unknown" (explicit, never hidden).
 */
export function accessRows(access) {
  const formats = Array.isArray(access?.formats) && access.formats.length ? access.formats.join(', ') : null;
  return [
    { key: 'cost', label: 'Cost', value: costLabel(access), provenance: provenanceFor(access, 'cost.model'), note: access?.cost?.free_tier || access?.cost?.price_notes || null },
    { key: 'rate_limit', label: 'Rate limit', value: rateLimitLabel(access), provenance: provenanceFor(access, 'rate_limit') },
    { key: 'auth', label: 'Auth', value: authLabel(access), provenance: provenanceFor(access, 'auth.type'), link: access?.auth?.signup_url || null },
    { key: 'license', label: 'License', value: licenseLabel(access), provenance: provenanceFor(access, 'license'), link: access?.license?.url || null },
    { key: 'formats', label: 'Formats', value: formats, provenance: provenanceFor(access, 'formats') },
  ];
}

/** Score breakdown rows: { key, label, value 0-100, weightPct, placeholder? }. */
export function scoreRows(record) {
  const s = apiSignalScores(record);
  return SIGNAL_LABELS.map(([key, label]) => ({
    key,
    label,
    value: Math.round(s[key] ?? 0),
    weightPct: Math.round((FEED_WEIGHTS[key] ?? 0) * 100),
    placeholder: PLACEHOLDER_SIGNALS[key] || null,
  }));
}

/** First base URL's host, else home_url's host, else null. */
export function primaryHost(record) {
  const candidates = [...(record?.extra?.base_urls || []), record?.home_url].filter(Boolean);
  for (const u of candidates) {
    try { return new URL(u).host; } catch { /* not a URL — try the next */ }
  }
  return null;
}

/** Display provider: extra.provider, else the slug's first segment. */
export function providerName(record) {
  return record?.extra?.provider || String(record?.slug || '').split('/')[0] || '';
}

/** Index card summary: up to three short facts, each known-only. */
export function cardFacts(record) {
  const a = record?.access;
  return [costLabel(a), authLabel(a), rateLimitLabel(a) ? 'Rate limit known' : null].filter(Boolean);
}

/** Sort for listings: score desc, then name, then id (stable across builds). */
export function compareApis(a, b) {
  return (b.quality_score || 0) - (a.quality_score || 0)
    || String(a.name || '').localeCompare(String(b.name || ''))
    || String(a.id).localeCompare(String(b.id));
}

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/**
 * Decode the HTML entities some catalogs ship inside plain-text fields
 * (data.gouv.fr descriptions carry `L&#39;API`). Astro escapes on render, so
 * an undecoded entity would show up literally. Unknown named entities are
 * left as-is.
 */
export function decodeEntities(text) {
  if (text == null) return '';
  return String(text).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Pick `n` records round-robin across `origin.source`, each source's list in
 * compareApis order — a display-level diversity rule so one catalog cannot
 * fill a showcase grid (the 4.2 calibration found per-source score bias;
 * the retune itself is a separate reviewed change).
 */
export function diverseTop(records, n) {
  const bySource = new Map();
  for (const r of [...(records || [])].sort(compareApis)) {
    const s = r?.origin?.source || 'unknown';
    if (!bySource.has(s)) bySource.set(s, []);
    bySource.get(s).push(r);
  }
  const queues = [...bySource.values()].sort((a, b) => compareApis(a[0], b[0]));
  const out = [];
  while (out.length < n && queues.some((q) => q.length)) {
    for (const q of queues) {
      if (out.length >= n) break;
      if (q.length) out.push(q.shift());
    }
  }
  return out;
}

/** Records that get a page/listing: every non-duplicate api record. */
export function visibleApis(records) {
  return (records || []).filter((r) => r && r.slug && r.is_duplicate !== true);
}
