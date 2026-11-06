/**
 * scripts/lib/access.js — Phase 4.1 / D-03. Shared `access` block helpers.
 *
 * Shape per docs/PHASE-4.0-SPEC.md § "Shared access block": `cost`,
 * `rate_limit`, `auth`, `license`, `formats`, `transport`, `provenance`
 * (keyed by field path, each `{ method, source_url, confidence, checked_at }`).
 * `unknown` is a first-class value: every enum defaults to `'unknown'`,
 * numbers to `null`, arrays to `[]`, provenance to `{}`.
 *
 * The block lives TOP-LEVEL on `api` / `dataset` EntityRecords only (never on
 * EntityCommon, never under `extra`) — see src/lib/types.d.ts `AccessBlock`.
 *
 * Exports:
 *   - emptyAccess()                              fresh unknown-first block
 *   - mergeAccess(base, partial)                 deep-fill a partial block onto a base copy
 *   - setAccessField(access, path, value, prov)  set + stamp provenance (mutates, returns access)
 *   - accessClarity(access)                      0-1, one third per known field
 *   - normalizeProvenance(e)                     canonical provenance entry
 *   - UNKNOWN                                    'unknown'
 *
 * No file I/O here — pure helpers.
 */

export const UNKNOWN = 'unknown';

/** Clamp to [0, 1]; non-finite (incl. NaN / undefined) → 1 ("unstated confidence = full"). */
const clamp01 = (n) => {
  const x = Number(n);
  if (!Number.isFinite(x)) return 1;
  return Math.min(1, Math.max(0, x));
};

/** Coerce to a string array (non-strings dropped). */
const strArr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);

/**
 * Fresh unknown-first access block. A new literal on every call so callers
 * can mutate freely (setAccessField mutates in place).
 *
 * @returns {import('../../src/lib/types.js').AccessBlock}
 */
export function emptyAccess() {
  return {
    cost: { model: UNKNOWN, free_tier: null, price_notes: null },
    rate_limit: { requests: null, per: null, notes: null, headers_observed: [] },
    auth: { type: UNKNOWN, signup_url: null },
    license: { spdx: null, name: null, url: null },
    formats: [],
    transport: null,
    provenance: {},
  };
}

/**
 * Canonical provenance entry. Missing/invalid fields fall back to
 * `method: 'manual'`, `source_url: null`, `confidence: 1`, `checked_at: ''`
 * (no timestamp is invented here — only setAccessField stamps "now").
 *
 * @param {any} e
 * @returns {{ method: string, source_url: string | null, confidence: number, checked_at: string }}
 */
export function normalizeProvenance(e) {
  return {
    method: typeof e?.method === 'string' ? e.method : 'manual',
    source_url: typeof e?.source_url === 'string' ? e.source_url : null,
    confidence: clamp01(e?.confidence ?? 1),
    checked_at: typeof e?.checked_at === 'string' ? e.checked_at : '',
  };
}

const GROUPS = ['cost', 'rate_limit', 'auth', 'license'];

/**
 * Deep-fill a partial access block onto a copy of `base` (defaults to
 * emptyAccess()). `base` is never mutated. Only keys that already exist on
 * the base group are copied (unknown top-level keys such as `bogus` and
 * unknown group keys are ignored). Provenance entries are normalised.
 * Numbers in `rate_limit.requests` are kept as given (no coercion in 4.1).
 *
 * @param {any} base
 * @param {any} partial
 * @returns {import('../../src/lib/types.js').AccessBlock}
 */
export function mergeAccess(base, partial) {
  const out = structuredClone(base ?? emptyAccess());
  if (!partial || typeof partial !== 'object') return out;
  for (const group of GROUPS) {
    const p = partial[group];
    if (!p || typeof p !== 'object') continue;
    for (const key of Object.keys(out[group])) {
      if (p[key] !== undefined) out[group][key] = p[key];
    }
  }
  out.rate_limit.headers_observed = strArr(out.rate_limit.headers_observed);
  if (partial.formats !== undefined) out.formats = strArr(partial.formats);
  if (partial.transport !== undefined) {
    out.transport = typeof partial.transport === 'string' ? partial.transport : null;
  }
  if (partial.provenance && typeof partial.provenance === 'object') {
    for (const [k, e] of Object.entries(partial.provenance)) {
      out.provenance[k] = normalizeProvenance(e);
    }
  }
  return out;
}

/**
 * Set one access field and stamp its provenance. Mutates `access` and
 * returns it.
 *
 * `path` is either `'<group>.<key>'` (e.g. `'auth.type'`,
 * `'rate_limit.requests'`) or one of the single-segment paths `'formats'` /
 * `'transport'`. Anything else — including `'provenance'` and keys that do
 * not exist on the group — throws `unknown path`.
 *
 * Provenance defaults: `method 'manual'`, `source_url null`, `confidence 1`
 * (clamped to [0, 1]), `checked_at` = now (ISO 8601).
 *
 * @param {any} access
 * @param {string} path
 * @param {any} value
 * @param {{ method?: string, source_url?: string | null, confidence?: number, checked_at?: string }} [prov]
 * @returns {any} the same `access` object
 */
export function setAccessField(access, path, value, prov) {
  const [group, key, ...rest] = String(path).split('.');
  if (rest.length) throw new Error(`setAccessField: unknown path ${path}`);
  if (key === undefined) {
    if (group !== 'formats' && group !== 'transport') {
      throw new Error(`setAccessField: unknown path ${path}`);
    }
    access[group] = group === 'formats' ? strArr(value) : value;
  } else {
    if (
      group === 'provenance'
      || !access[group]
      || typeof access[group] !== 'object'
      || !Object.prototype.hasOwnProperty.call(access[group], key)
    ) {
      throw new Error(`setAccessField: unknown path ${path}`);
    }
    access[group][key] = value;
  }
  access.provenance[path] = {
    method: prov?.method ?? 'manual',
    source_url: prov?.source_url ?? null,
    confidence: clamp01(prov?.confidence ?? 1),
    checked_at: prov?.checked_at ?? new Date().toISOString(),
  };
  return access;
}

/**
 * Access clarity, 0-1 (D-03): one third each for a KNOWN auth type, a KNOWN
 * cost model and a KNOWN rate limit, each third multiplied by that field's
 * provenance confidence (missing provenance → confidence 1). `'unknown'` and
 * empty strings count 0.
 *
 * Rate-limit rule: a structured limit (`rate_limit.requests` is a number AND
 * `rate_limit.per` is set) earns the full third × conf('rate_limit.requests').
 * A NOTES-ONLY rate limit (non-blank `rate_limit.notes`, no structured
 * numbers) earns HALF credit × conf('rate_limit.notes') — data.gouv.fr
 * declares its limits as free text ("quota de 30 appels par minute"), which
 * is real information but not machine-usable, so it is worth something but
 * not everything.
 *
 * @param {any} access
 * @returns {number} 0-1
 */
export function accessClarity(access) {
  if (!access || typeof access !== 'object') return 0;
  const conf = (p) => clamp01(access.provenance?.[p]?.confidence ?? 1);
  const known = (v) => typeof v === 'string' && v !== '' && v !== UNKNOWN;
  const auth = known(access.auth?.type) ? conf('auth.type') : 0;
  const cost = known(access.cost?.model) ? conf('cost.model') : 0;
  let rl = 0;
  if (typeof access.rate_limit?.requests === 'number' && access.rate_limit?.per) {
    rl = conf('rate_limit.requests');
  } else if (typeof access.rate_limit?.notes === 'string' && access.rate_limit.notes.trim()) {
    rl = 0.5 * conf('rate_limit.notes');
  }
  return (auth + cost + rl) / 3;
}
