/**
 * scripts/lib/feeds/api-access.js
 *
 * Phase 4.2 (D-04 ladder steps 1-2, 4.2-M06; orchestrator decisions 2, 4, 5).
 * Pure. Every write goes through setAccessField so provenance is stamped; the
 * ONLY direct provenance write is the decision-2 `base_urls` marker for
 * public-apis records.
 *
 *   - spec (ladder step 1): securitySchemes → auth.type + auth.schemes (0.9),
 *     info.license → license (0.9), response media types → formats (0.8),
 *     transport rest|graphql (0.9).
 *   - declared (ladder step 2): data.gouv.fr rate_limiting (0.8),
 *     access_type (0.7), license (0.9); UK catalogue license (0.8);
 *     public-apis Auth (0.6); cost.model 'free' for the three open catalogs
 *     (0.7); public-apis base_urls = [Link] marked declared 0.5 (decision 2).
 *
 * No I/O, no clock reads (checkedAt is always passed in).
 */

import { emptyAccess, setAccessField, UNKNOWN } from '../access.js';

export const AUTH_PRECEDENCE = ['api_key', 'bearer', 'oauth2', 'http_basic', 'openid'];
export const COST_FREE_SOURCES = ['data.gouv.fr', 'uk-api-catalogue', 'public-apis'];

const CONF = {
  spec_auth: 0.9,
  spec_license: 0.9,
  spec_formats: 0.8,
  spec_transport: 0.9,
  gouv_rate: 0.8,
  gouv_access_type: 0.7,
  gouv_license: 0.9,
  uk_license: 0.8,
  pub_auth: 0.6,
  cost_free: 0.7,
  pub_base_url: 0.5,
};

// key = normLicenseName(name): lowercase, trim, trailing ' license'/' licence'
// stripped, non-alnum runs collapsed to one space. Lookups try the stripped
// AND the unstripped form.
const SPDX_BY_NAME = new Map([
  ['mit', 'MIT'], ['apache 2 0', 'Apache-2.0'], ['apache 2', 'Apache-2.0'], ['apache license 2 0', 'Apache-2.0'],
  ['apache license version 2 0', 'Apache-2.0'], ['apache', 'Apache-2.0'],
  ['bsd 3 clause', 'BSD-3-Clause'], ['bsd 2 clause', 'BSD-2-Clause'], ['isc', 'ISC'], ['mpl 2 0', 'MPL-2.0'],
  ['gpl 3 0', 'GPL-3.0-only'], ['lgpl 3 0', 'LGPL-3.0-only'],
  ['cc0', 'CC0-1.0'], ['cc0 1 0', 'CC0-1.0'], ['creative commons zero', 'CC0-1.0'], ['public domain', 'CC0-1.0'],
  ['cc by', 'CC-BY-4.0'], ['cc by 4 0', 'CC-BY-4.0'], ['creative commons attribution 4 0', 'CC-BY-4.0'],
  ['creative commons attribution', 'CC-BY-4.0'],
  ['cc by 3 0', 'CC-BY-3.0'], ['creative commons attribution 3 0', 'CC-BY-3.0'], ['cc by sa 4 0', 'CC-BY-SA-4.0'],
  ['cc by nc 4 0', 'CC-BY-NC-4.0'],
  ['ogl uk 3 0', 'OGL-UK-3.0'], ['ogl', 'OGL-UK-3.0'], ['open government', 'OGL-UK-3.0'], ['open government v3', 'OGL-UK-3.0'],
  ['open government licence', 'OGL-UK-3.0'], ['open government licence v3', 'OGL-UK-3.0'], ['open government license', 'OGL-UK-3.0'],
  ['lov2', 'etalab-2.0'], ['licence ouverte 2 0', 'etalab-2.0'], ['licence ouverte', 'etalab-2.0'], ['etalab 2 0', 'etalab-2.0'],
  ['etalab', 'etalab-2.0'],
  ['odc odbl', 'ODbL-1.0'], ['odbl', 'ODbL-1.0'], ['odbl 1 0', 'ODbL-1.0'], ['odc by', 'ODC-By-1.0'], ['pddl', 'PDDL-1.0'],
]);

const FORMAT_MAP = new Map([
  ['application/json', 'json'], ['text/json', 'json'], ['application/xml', 'xml'], ['text/xml', 'xml'], ['text/csv', 'csv'],
  ['text/plain', 'text'], ['application/x-ndjson', 'ndjson'], ['application/jsonlines', 'ndjson'],
  ['application/geo+json', 'geojson'], ['application/ld+json', 'jsonld'], ['text/html', 'html'],
  ['application/pdf', 'pdf'], ['application/octet-stream', 'binary'], ['application/zip', 'zip'],
  ['application/x-protobuf', 'protobuf'], ['application/grpc', 'protobuf'],
  ['application/yaml', 'yaml'], ['application/x-yaml', 'yaml'], ['text/yaml', 'yaml'],
  ['application/rss+xml', 'rss'], ['application/atom+xml', 'atom'],
]);

const norm = (s) => String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim();

function lookupSpdx(name) {
  if (!name) return null;
  const raw = String(name).toLowerCase().trim();
  const stripped = raw.replace(/\s+licen[cs]e$/, '');
  return SPDX_BY_NAME.get(norm(stripped)) ?? SPDX_BY_NAME.get(norm(raw)) ?? null;
}

/**
 * One OpenAPI security-scheme definition → AccessBlock auth.type vocabulary.
 *
 * @param {any} def
 * @returns {'api_key' | 'bearer' | 'http_basic' | 'oauth2' | 'openid' | 'unknown'}
 */
export function mapScheme(def) {
  const t = String(def?.type ?? '').toLowerCase();
  const s = String(def?.scheme ?? '').toLowerCase();
  if (t === 'apikey') return 'api_key';
  if (t === 'http' && s === 'bearer') return 'bearer';
  if (t === 'http' && s === 'basic') return 'http_basic';
  if (t === 'oauth2') return 'oauth2';
  if (t === 'openidconnect') return 'openid';
  return UNKNOWN;
}

/**
 * Decision 5: `schemes` = every declared, mappable scheme (declaration order,
 * deduped); `type` = the first scheme named by the first global security
 * requirement, else the highest in AUTH_PRECEDENCE; 'none' when nothing maps.
 *
 * @param {{ schemes?: Record<string, any>, requirements?: any[] } | null | undefined} security
 * @returns {{ type: string, schemes: string[] }}
 */
export function mapSecuritySchemes(security) {
  const entries = Object.entries(security?.schemes || {})
    .map(([k, d]) => [k, mapScheme(d)])
    .filter(([, t]) => t !== UNKNOWN);
  if (!entries.length) return { type: 'none', schemes: [] };
  const byKey = new Map(entries);
  const schemes = [...new Set(entries.map(([, t]) => t))];
  let type = null;
  const first = Array.isArray(security?.requirements) ? security.requirements[0] : null;
  if (first && typeof first === 'object') {
    for (const k of Object.keys(first)) {
      if (byKey.has(k)) { type = byKey.get(k); break; }
    }
  }
  if (!type) type = AUTH_PRECEDENCE.find((t) => schemes.includes(t)) ?? 'none';
  return { type, schemes };
}

/**
 * @param {{ name?: string, url?: string } | string | null | undefined} input
 * @returns {{ spdx: string | null, name: string | null, url: string | null }}
 */
export function mapLicense(input) {
  if (input == null) return { spdx: null, name: null, url: null };
  let name = null;
  let url = null;
  if (typeof input === 'string') {
    const s = input.trim();
    if (/^https?:\/\//i.test(s)) url = s;
    else name = s || null;
  } else if (typeof input === 'object') {
    name = typeof input.name === 'string' ? input.name.trim() || null : null;
    url = typeof input.url === 'string' ? input.url : null;
  }
  const spdx = lookupSpdx(name) ?? (url ? /spdx\.org\/licenses\/([A-Za-z0-9.+-]+)/.exec(url)?.[1] ?? null : null);
  return { spdx, name, url };
}

/**
 * Whitelist-map raw media types to short format names (Pitfall 9: drops
 * `*\/*`, typos and vendor binaries). Unique, first-seen order.
 *
 * @param {unknown} list
 * @returns {string[]}
 */
export function mediaTypesToFormats(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const push = (f) => { if (!out.includes(f)) out.push(f); };
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const mt = raw.toLowerCase().split(';')[0].trim();
    if (FORMAT_MAP.has(mt)) push(FORMAT_MAP.get(mt));
    else if (mt.startsWith('image/')) push('image');
    else if (mt.endsWith('+json')) push('json');
    else if (mt.endsWith('+xml')) push('xml');
  }
  return out;
}

// Decision 4: the D-04 anchored regex first, then the FR/EN superset.
const D04 = /^\s*(\d[\d,.]*)\s*(req|requests|calls|appels)?\s*(\/|per|par)\s*(second|sec|s|minute|min|hour|h|day|jour|month|mois)\b/i;
const SUPER = /(\d[\d\s,.]*)\s*(req|requests|requêtes|requetes|calls|appels|hits)?\s*(\/|per|par)\s*(seconde|second|sec|s|minute|min|heure|hour|h|jour|day|mois|month)\b/i;
const UNIT = {
  s: 'second', sec: 'second', second: 'second', seconde: 'second',
  min: 'minute', minute: 'minute',
  h: 'hour', hour: 'hour', heure: 'hour',
  day: 'day', jour: 'day',
  month: 'month', mois: 'month',
};

function parseCount(s) {
  const t = s.replace(/[\s,]/g, '');
  const n = /^\d{1,3}(\.\d{3})+$/.test(t) ? Number(t.replace(/\./g, '')) : Number(t);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Free-text rate limit → { requests, per }; both null when not machine-parseable.
 *
 * @param {unknown} raw
 * @returns {{ requests: number | null, per: 'second' | 'minute' | 'hour' | 'day' | 'month' | null }}
 */
export function parseRateLimit(raw) {
  if (typeof raw !== 'string') return { requests: null, per: null };
  const m = D04.exec(raw) || SUPER.exec(raw);
  if (!m) return { requests: null, per: null };
  const requests = parseCount(m[1]);
  const per = UNIT[m[4].toLowerCase()] || null;
  return requests && per ? { requests, per } : { requests: null, per: null };
}

/**
 * public-apis `Auth` column (literal values from resources.json) → auth.type.
 *
 * @param {unknown} auth
 */
export function publicApisAuth(auth) {
  switch (auth) {
    case '':
    case 'No':
      return 'none';
    case 'apiKey':
      return 'api_key';
    case 'OAuth':
      return 'oauth2';
    case 'X-Mashape-Key':
      return 'api_key';
    case 'User-Agent':
      return 'none';
    default:
      return UNKNOWN;
  }
}

function setLicense(a, L, prov) {
  if (L.spdx) setAccessField(a, 'license.spdx', L.spdx, prov);
  if (L.name) setAccessField(a, 'license.name', L.name, prov);
  if (L.url) setAccessField(a, 'license.url', L.url, prov);
}

/**
 * Ladder step 1 (spec): a full AccessBlock from an extractOpenApi() result.
 *
 * @param {any} ex  extractOpenApi output
 * @param {string | null} specUrl
 * @param {string} checkedAt  ISO 8601
 */
export function accessFromSpec(ex, specUrl, checkedAt) {
  const a = emptyAccess();
  const P = (c) => ({ method: 'spec', source_url: specUrl ?? null, confidence: c, checked_at: checkedAt });
  const { type, schemes } = mapSecuritySchemes(ex?.security);
  setAccessField(a, 'auth.type', type, P(CONF.spec_auth));
  setAccessField(a, 'auth.schemes', schemes, P(CONF.spec_auth));
  setLicense(a, mapLicense(ex?.license), P(CONF.spec_license));
  const f = mediaTypesToFormats(ex?.media_types);
  if (f.length) setAccessField(a, 'formats', f, P(CONF.spec_formats));
  setAccessField(a, 'transport', ex?.transport === 'graphql' ? 'graphql' : 'rest', P(CONF.spec_transport));
  return a;
}

/**
 * Ladder step 2 (declared): a full AccessBlock from a raw record's
 * origin.source + raw_source. Unknown sources get an untouched emptyAccess().
 *
 * @param {any} rec  raw api record (parser output)
 * @param {string} checkedAt  ISO 8601
 */
export function accessForRecord(rec, checkedAt) {
  const a = emptyAccess();
  const src = rec?.origin?.source;
  const rs = rec?.raw_source || {};
  const D = (c, url = rec?.origin?.source_url ?? null) => ({ method: 'declared', source_url: url, confidence: c, checked_at: checkedAt });

  switch (src) {
    case 'data.gouv.fr': {
      if (typeof rs.rate_limiting === 'string' && rs.rate_limiting.trim()) {
        setAccessField(a, 'rate_limit.notes', rs.rate_limiting.trim(), D(CONF.gouv_rate));
        const { requests, per } = parseRateLimit(rs.rate_limiting);
        if (requests) {
          setAccessField(a, 'rate_limit.requests', requests, D(CONF.gouv_rate));
          setAccessField(a, 'rate_limit.per', per, D(CONF.gouv_rate));
        }
      }
      if (rs.access_type === 'open') setAccessField(a, 'auth.type', 'none', D(CONF.gouv_access_type));
      else if (rs.access_type === 'restricted' || rs.access_type === 'open_with_account') {
        setAccessField(a, 'auth.type', 'api_key', D(CONF.gouv_access_type));
      }
      if (rs.license) setLicense(a, mapLicense(rs.license), D(CONF.gouv_license));
      break;
    }
    case 'uk-api-catalogue': {
      if (typeof rs.license === 'string' && rs.license.trim()) {
        setLicense(a, mapLicense(rs.license.trim()), D(CONF.uk_license));
      }
      break;
    }
    case 'public-apis': {
      const t = publicApisAuth(rs.Auth);
      if (t !== UNKNOWN) setAccessField(a, 'auth.type', t, D(CONF.pub_auth));
      // Decision 2: base_urls = [Link] is a declared guess, not a verified base URL.
      a.provenance.base_urls = {
        method: 'declared',
        source_url: rec?.home_url ?? rs.Link ?? null,
        confidence: CONF.pub_base_url,
        checked_at: checkedAt,
      };
      break;
    }
    case 'apis.guru': {
      if (rs.info_license) {
        const P = (c) => ({ method: 'spec', source_url: rec?.origin?.source_url ?? null, confidence: c, checked_at: checkedAt });
        setLicense(a, mapLicense(rs.info_license), P(CONF.spec_license));
      }
      break;
    }
    default:
      break;
  }

  if (COST_FREE_SOURCES.includes(src)) setAccessField(a, 'cost.model', 'free', D(CONF.cost_free));
  return a;
}
