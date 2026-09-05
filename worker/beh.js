/**
 * worker/beh.js — behavioral-beacon geo-gate + identifier-free D1 ingest
 * (quick-260905-fib, L4, BEH-02..04 + PRIV-01..04).
 *
 * The client (src/layouts/BaseLayout.astro) computes ~10 STRUCTURAL interaction
 * aggregates in the browser, scores an automation band with src/lib/beh-score.js
 * IN THE BROWSER, and POSTs ONLY those aggregate numbers + the score + band
 * here. No raw event stream, no coordinates, no key identities, no per-key
 * timing, and NO device identifier ever leaves the browser or is stored.
 *
 * This module is the server half. It mirrors two established shapes:
 *   - worker/asn-class.js — pure named exports, zero I/O, never throws.
 *   - worker/request-log.js — lazy CREATE-on-"no such table" via the Worker's
 *     own DB binding + ctx.waitUntil non-blocking insert, and the
 *     incident-fixed MISSING_COLUMN_RE for any FUTURE ADD COLUMN path.
 *
 * PRIVACY INVARIANTS (all BLOCKERS):
 *   PRIV-01  Only aggregate numbers + score + band + path are stored; raw is
 *            never accepted (validateBehPayload whitelists columns).
 *   PRIV-02  EU/EEA/UK is NEVER instrumented. Enforced in THREE places:
 *            (a) decideActivate → activate:false so the client attaches no
 *                listeners and makes no POST; (b) handleBehActivate sends
 *                cache-control: no-store so the per-country decision is never
 *                cached; (c) handleBehIngest re-drops any EU POST that reaches
 *                the worker anyway (defense in depth) with no DB write.
 *   PRIV-03  behavior_log has NO identifier column — no ip_hash, no cookie, no
 *            nonce, no fingerprint. The beacon is stateless per pageview.
 *   PRIV-04  keydown is a COUNT scalar only; no per-key identity/timing is ever
 *            accepted or stored (the scorer + validator both treat it as a
 *            plain number).
 */

// ---------------------------------------------------------------------------
// Geo gate — EU (27) + EEA (IS, LI, NO) + UK (GB, UK GDPR). ISO-3166 alpha-2,
// UPPERCASE (Cloudflare's request.cf.country is uppercase).
// ---------------------------------------------------------------------------
export const EU_EEA_UK = new Set([
  // 27 EU members
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR',
  'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA non-EU
  'IS', 'LI', 'NO',
  // UK (UK GDPR)
  'GB',
]);

/** isEuCountry(country) → boolean. Case-sensitive (cf.country is uppercase). Never throws. */
export function isEuCountry(country) {
  return typeof country === 'string' && EU_EEA_UK.has(country);
}

/**
 * decideActivate(country, env) → { activate:boolean }.
 *
 * false when the country is EU/EEA/UK OR the feature flag disables it. Default
 * ON when the flag is unset — only the exact string 'false' disables — so no
 * wrangler/secret change is required to ship. Never throws.
 */
export function decideActivate(country, env) {
  if (isEuCountry(country)) return { activate: false };
  const flag = env && env.BEH_BEACON_ENABLED;
  if (flag === 'false') return { activate: false };
  return { activate: true };
}

// ---------------------------------------------------------------------------
// behavior_log schema. IDENTIFIER-FREE by construction (PRIV-03). Kept IN SYNC
// with worker/schema.sql — that file remains the source of truth; this is an
// import-free duplicate because schema.sql can't be imported from Worker code
// (same rationale as REQUEST_LOG_DDL).
//
// BEHAVIOR_LOG_COLUMNS is the INSERT bind order (minus the autoincrement id).
// has_wheel is stored as INTEGER 0/1.
// ---------------------------------------------------------------------------
export const BEHAVIOR_LOG_COLUMNS = [
  'timestamp',
  'path',
  'country',
  'mouse_event_rate',
  'has_wheel',
  'wheel_count',
  'teleport_click_ratio',
  'click_count',
  'pointer_move_count',
  'keydown_count',
  'session_ms',
  'click_duration_spread',
  'interaction_total',
  'score',
  'band',
];

export const BEHAVIOR_LOG_DDL = [
  `CREATE TABLE IF NOT EXISTS behavior_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  path TEXT,
  country TEXT,
  mouse_event_rate REAL,
  has_wheel INTEGER,
  wheel_count INTEGER,
  teleport_click_ratio REAL,
  click_count INTEGER,
  pointer_move_count INTEGER,
  keydown_count INTEGER,
  session_ms INTEGER,
  click_duration_spread REAL,
  interaction_total INTEGER,
  score REAL,
  band TEXT
)`,
  'CREATE INDEX IF NOT EXISTS idx_behavior_log_timestamp ON behavior_log(timestamp)',
];

const INSERT_SQL = `INSERT INTO behavior_log (${BEHAVIOR_LOG_COLUMNS.join(', ')}) VALUES (${BEHAVIOR_LOG_COLUMNS.map(() => '?').join(', ')})`;

const VALID_BANDS = new Set(['human-shaped', 'uncertain', 'automation-signature']);

// Whole-payload size cap (chars of JSON). The legitimate payload is ~300 bytes;
// anything materially larger is junk/abuse and is rejected up front.
const MAX_PAYLOAD_CHARS = 4096;
const MAX_PATH_CHARS = 256;

// Sane per-field clamp bounds. Everything is a non-negative aggregate; ratios
// and the score are 0..1; counts/durations get a generous but finite ceiling.
const COUNT_MAX = 10_000_000;
const RATE_MAX = 100_000;
const SESSION_MS_MAX = 24 * 60 * 60 * 1000; // 24h
const SPREAD_MAX = 3_600_000; // 1h in ms, generous

function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

// Strict finite-number coercion: returns null for non-numeric / NaN / Infinity
// so the caller can REJECT (never silently coerce junk to 0 — that would let
// garbage through validation).
function strictNum(v) {
  if (typeof v !== 'number') return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

/**
 * validateBehPayload(body) → { ok:true, row } | { ok:false, reason }.
 *
 * body shape (from the client): { path, score, band, features:{...} }.
 * Returns a row keyed by EXACTLY BEHAVIOR_LOG_COLUMNS — timestamp and country
 * are null placeholders filled server-side by handleBehIngest. NEVER accepts or
 * emits any identifier, coordinate stream, or key value. Never throws.
 */
export function validateBehPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, reason: 'not_an_object' };
  }

  // Bounded: reject an oversize body up front.
  let serialized;
  try {
    serialized = JSON.stringify(body);
  } catch {
    return { ok: false, reason: 'unserializable' };
  }
  if (typeof serialized !== 'string' || serialized.length > MAX_PAYLOAD_CHARS) {
    return { ok: false, reason: 'too_large' };
  }

  const band = body.band;
  if (typeof band !== 'string' || !VALID_BANDS.has(band)) {
    return { ok: false, reason: 'bad_band' };
  }

  const score = strictNum(body.score);
  if (score === null) return { ok: false, reason: 'bad_score' };

  const f = body.features;
  if (!f || typeof f !== 'object' || Array.isArray(f)) {
    return { ok: false, reason: 'bad_features' };
  }

  // Every feature field must be strictly numeric (reject NaN/Infinity/strings).
  const mouse_event_rate = strictNum(f.mouse_event_rate);
  const wheel_count = strictNum(f.wheel_count);
  const teleport_click_ratio = strictNum(f.teleport_click_ratio);
  const click_count = strictNum(f.click_count);
  const pointer_move_count = strictNum(f.pointer_move_count);
  const keydown_count = strictNum(f.keydown_count);
  const session_ms = strictNum(f.session_ms);
  const click_duration_spread = strictNum(f.click_duration_spread);
  const interaction_total = strictNum(f.interaction_total);
  if (
    mouse_event_rate === null || wheel_count === null || teleport_click_ratio === null ||
    click_count === null || pointer_move_count === null || keydown_count === null ||
    session_ms === null || click_duration_spread === null || interaction_total === null
  ) {
    return { ok: false, reason: 'non_numeric_feature' };
  }

  // has_wheel: coerce to strict boolean → INTEGER 0/1.
  const has_wheel = f.has_wheel === true ? 1 : 0;

  const path = typeof body.path === 'string' ? body.path.slice(0, MAX_PATH_CHARS) : null;

  // Clamp every numeric to sane bounds. Row keys === BEHAVIOR_LOG_COLUMNS.
  const row = {
    timestamp: null, // filled server-side (Date.now())
    path,
    country: null, // filled server-side (request.cf.country)
    mouse_event_rate: clamp(mouse_event_rate, 0, RATE_MAX),
    has_wheel,
    wheel_count: Math.round(clamp(wheel_count, 0, COUNT_MAX)),
    teleport_click_ratio: clamp(teleport_click_ratio, 0, 1),
    click_count: Math.round(clamp(click_count, 0, COUNT_MAX)),
    pointer_move_count: Math.round(clamp(pointer_move_count, 0, COUNT_MAX)),
    keydown_count: Math.round(clamp(keydown_count, 0, COUNT_MAX)), // COUNT ONLY (PRIV-04)
    session_ms: Math.round(clamp(session_ms, 0, SESSION_MS_MAX)),
    click_duration_spread: clamp(click_duration_spread, 0, SPREAD_MAX),
    interaction_total: Math.round(clamp(interaction_total, 0, COUNT_MAX)),
    score: clamp(score, 0, 1),
    band,
  };

  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// JSON response helper (self-contained — beh.js must not import from index.js).
// ---------------------------------------------------------------------------
function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      ...extraHeaders,
    },
  });
}

/**
 * handleBehActivate(request, env) → Response (GET).
 *
 * Returns { activate } keyed off request.cf.country. cache-control: no-store is
 * MANDATORY — the decision varies by country and must NEVER be edge-cached
 * (PRIV-02: a cached activate:true served to an EU visitor would instrument
 * them). Never throws.
 */
export async function handleBehActivate(request, env) {
  try {
    const country = (request && request.cf && request.cf.country) || null;
    const decision = decideActivate(country, env);
    return jsonResponse(decision, 200, { 'cache-control': 'no-store' });
  } catch (err) {
    console.error('beh activate error:', err && err.message);
    // Fail closed: on any error, do NOT instrument.
    return jsonResponse({ activate: false }, 200, { 'cache-control': 'no-store' });
  }
}

// At-most-once-per-isolate guard for the DDL path (mirrors request-log.js).
let migrationAttempted = false;

// Test hook — resets the module-level migration flag between test cases.
export function _resetBehMigrationAttempted() {
  migrationAttempted = false;
}

// INCIDENT FIX (2026-08-09, carried from request-log.js): SQLite reports a
// missing column differently by context — SELECT says "no such column: X",
// INSERT says "table X has no column named Y". Match BOTH so any FUTURE
// behavior_log ADD COLUMN path never silently drops rows. No columns ship as
// migrations here yet (the table is created whole), but the regex is kept
// intact for future use — do NOT regress it.
// eslint-disable-next-line no-unused-vars
const MISSING_COLUMN_RE = /no such column|has no column named/i;

// Non-blocking D1 insert with lazy CREATE-on-"no such table". Runs inside
// ctx.waitUntil — NEVER throws or rejects into the response path.
async function insertBehRow(env, row) {
  try {
    if (!env || !env.DB) return;
    const values = BEHAVIOR_LOG_COLUMNS.map((col) => row[col]);
    try {
      await env.DB.prepare(INSERT_SQL).bind(...values).run();
    } catch (err) {
      const message = String((err && err.message) || '');
      if (!migrationAttempted && /no such table/i.test(message)) {
        // Lazy self-migration via the Worker's own DB binding (the .env
        // CF_API_TOKEN lacks D1 DDL permission — same constraint as
        // request_log; the LIVE table is created here on first insert).
        migrationAttempted = true;
        for (const stmt of BEHAVIOR_LOG_DDL) {
          await env.DB.prepare(stmt).run();
        }
        await env.DB.prepare(INSERT_SQL).bind(...values).run();
      } else {
        throw err; // handed to the outer catch — logged, never rethrown
      }
    }
  } catch (err) {
    console.error('beh insert error:', err && err.message);
  }
}

/**
 * handleBehIngest(request, env, ctx) → Response (POST).
 *
 * Always returns a fast 204 REGARDLESS of the insert outcome — the beacon must
 * never block, slow, or break the page. Steps:
 *   1. DOUBLE-CHECK the geo gate (defense in depth, PRIV-02): drop any EU POST
 *      silently with no DB write.
 *   2. Parse + validate the payload; invalid → 204 fast, no write.
 *   3. Stamp server-side timestamp + country, insert via ctx.waitUntil.
 * Fully try/caught — never throws.
 */
export async function handleBehIngest(request, env, ctx) {
  try {
    const country = (request && request.cf && request.cf.country) || null;

    // Defense in depth: EU/EEA/UK is NEVER stored, even if a POST reaches here.
    if (isEuCountry(country)) {
      return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
    }

    let body = null;
    try {
      body = await request.json();
    } catch {
      body = null; // malformed JSON → fall through to invalid path
    }

    const result = validateBehPayload(body);
    if (result.ok) {
      const row = result.row;
      row.timestamp = Date.now();
      row.country = country;
      const p = insertBehRow(env, row);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(p);
      else await p; // no ctx (tests / edge) → still insert, but never throw
    }

    // Fast, uniform 204 whether valid, invalid, or DB-less — the client never
    // reads the body (sendBeacon is fire-and-forget).
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  } catch (err) {
    console.error('beh ingest error:', err && err.message);
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
}
