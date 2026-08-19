#!/usr/bin/env node
/**
 * scripts/snapshot-traffic.js — daily traffic-analytics snapshot (quick-260818-ohb).
 *
 * Read-only aggregator that rolls up the Cloudflare D1 `request_log` table into
 * a small, committed per-day time-series file `data/traffic-snapshot.json`. It
 * mirrors the `snapshot-catalog.js` sidecar pattern (quick-260804-d5p) but
 * reads D1 over the HTTP `/query` REST endpoint instead of the catalog NDJSON.
 *
 * Purpose: accumulate a multi-day traffic trend for an upcoming report and seed
 * the future public "fingerprint feed". The first run backfills the existing
 * history (2026-08-07 → today).
 *
 * ── PATTERN NOTES ───────────────────────────────────────────────────────────
 * - Node 22 ESM, global `fetch`, NO wrangler import (workerd has no
 *   win32-arm64 build — this is a plain node script; the D1 REST endpoint is
 *   reached directly, exactly like scripts/apply-d1-schema.js).
 * - READ-ONLY: only `SELECT ... GROUP BY` COUNT(*) queries. NEVER selects
 *   ip_hash or any raw identifier — only aggregate counts leave the database.
 * - Robust: ANY failure (missing creds, network/fetch error, non-success D1
 *   response, unexpected shape) logs a clear `[snapshot-traffic]` warning and
 *   `process.exit(0)` WITHOUT touching the existing snapshot file. The script
 *   never throws and never exits non-zero — it must never break the daily cron.
 *
 * Usage:
 *   Local:  node --env-file=.env scripts/snapshot-traffic.js
 *   Cron:   node scripts/snapshot-traffic.js   (CF_* vars already in env:)
 *
 * Required env:
 *   CF_ACCOUNT_ID  — Cloudflare account id
 *   CF_API_TOKEN   — API token with D1 read permission (never logged)
 *
 * future optimization: add a rolling-window WHERE timestamp > cutoff once
 * request_log exceeds ~1M rows; recomputing all days is fine at current <1M
 * scale.
 */

import { existsSync, openSync, writeSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_PATH = join(ROOT, 'data', 'traffic-snapshot.json');

// claudeatlas-search-log — same database wrangler.toml binds as DB (verbatim
// from scripts/apply-d1-schema.js).
const DATABASE_ID = 'd4e341fa-17d6-4069-8a00-3b6a8d698ab9';

// Classifier v1 (network-aware) cutover day (quick-260812-p3b). Days strictly
// before this are pure v0; strictly after are pure v1; the cutover day itself
// carries a mix of both verdicts.
const CUTOVER = '2026-08-12';

// The six class{} keys always present in each day row (0 for absent), matching
// the request_log `class` domain (worker/schema.sql).
const CLASS_KEYS = [
  'crawler',
  'automated_unknown',
  'human',
  'unknown',
  'impersonation_suspected',
  'agent',
];

// ---------------------------------------------------------------------------
// D1 REST helper (verbatim from scripts/apply-d1-schema.js).
// ---------------------------------------------------------------------------
function queryUrl(accountId) {
  return `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${DATABASE_ID}/query`;
}

async function d1Query(url, token, sql) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ sql }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json || json.success === false) {
    const detail = json && json.errors ? JSON.stringify(json.errors) : `HTTP ${res.status}`;
    throw new Error(`D1 query failed: ${detail}`);
  }
  return json;
}

// A SELECT returns rows at json.result[0].results (array of plain objects keyed
// by the SELECT's output column names/aliases). Tolerate multiple result blocks.
function rowsOf(json) {
  if (!json || !Array.isArray(json.result)) return [];
  return json.result.flatMap((r) => (r && Array.isArray(r.results) ? r.results : []));
}

// ---------------------------------------------------------------------------
// Aggregate queries. All bucket by UTC calendar day; `timestamp` is stored in
// MILLISECONDS (Date.now()), so divide by 1000 for strftime's unixepoch.
// ---------------------------------------------------------------------------
const DAY_EXPR = "strftime('%Y-%m-%d', timestamp/1000, 'unixepoch')";

export const QUERIES = {
  // Q1: class counts per day.
  class: `SELECT ${DAY_EXPR} d, class, COUNT(*) n FROM request_log GROUP BY 1, 2`,
  // Q2: datacenter-coherent verdicts per day (the v0→v1 human-correction bucket).
  datacenter: `SELECT ${DAY_EXPR} d, COUNT(*) n FROM request_log WHERE classifier_method='coherent_datacenter' GROUP BY 1`,
  // Q3: impersonation-suspected split by declared operator per day.
  impersonation: `SELECT ${DAY_EXPR} d, operator, COUNT(*) n FROM request_log WHERE class='impersonation_suspected' GROUP BY 1, 2`,
  // Q4: Web-Bot-Auth verified signers per day.
  signers: `SELECT ${DAY_EXPR} d, wba_signer, COUNT(*) n FROM request_log WHERE wba_status='verified' GROUP BY 1, 2`,
  // Q5: scanner/credential-probe 404s per day.
  probes: `SELECT ${DAY_EXPR} d, COUNT(*) n FROM request_log WHERE status=404 AND (path LIKE '%.env%' OR path LIKE '%.php%' OR path LIKE '%wp-%' OR path LIKE '%.git%' OR path LIKE '%credential%' OR path LIKE '%aws%' OR path LIKE '%service%account%' OR path LIKE '%.ssh%' OR path LIKE '%.sql%' OR path LIKE '%backup%' OR path LIKE '%phpmyadmin%') GROUP BY 1`,
};

// ---------------------------------------------------------------------------
// Pure row assembly (unit-testable without D1).
// ---------------------------------------------------------------------------

/**
 * Which classifier version was live on a given UTC day.
 *   date <  CUTOVER → 'v0'
 *   date === CUTOVER → 'mixed'
 *   date >  CUTOVER → 'v1'
 * @param {string} date  'YYYY-MM-DD'
 * @returns {'v0'|'mixed'|'v1'}
 */
export function classifierVersionFor(date) {
  if (date < CUTOVER) return 'v0';
  if (date === CUTOVER) return 'mixed';
  return 'v1';
}

function emptyClassCounts() {
  const c = {};
  for (const k of CLASS_KEYS) c[k] = 0;
  return c;
}

// Normalise a nullable/empty operator or signer to the reserved 'unknown' key.
function bucketKey(v) {
  return typeof v === 'string' && v.trim() !== '' ? v : 'unknown';
}

// Sort an object's entries by count desc, then key asc, into a fresh object.
function sortedByCountDesc(obj) {
  const out = {};
  for (const [k, n] of Object.entries(obj).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    out[k] = n;
  }
  return out;
}

/**
 * Assemble per-day rows from the five aggregate query result sets.
 *
 * @param {{ class?: any[], datacenter?: any[], impersonation?: any[],
 *           signers?: any[], probes?: any[] }} q  arrays of row objects
 *   (each row has a `d` day plus the query's other columns; `n` = COUNT(*)).
 * @returns {Array<object>} days, ascending by date.
 */
export function buildDayRows(q = {}) {
  const classRows = q.class || [];
  const datacenterRows = q.datacenter || [];
  const impersonationRows = q.impersonation || [];
  const signerRows = q.signers || [];
  const probeRows = q.probes || [];

  // Per-day accumulators, keyed by date. Every day seen in ANY query gets a row.
  const byDay = new Map();
  const ensure = (d) => {
    if (!byDay.has(d)) {
      byDay.set(d, {
        class: emptyClassCounts(),
        coherent_datacenter: 0,
        impersonation_by_operator: {},
        verified_signers: {},
        probes: 0,
      });
    }
    return byDay.get(d);
  };

  for (const r of classRows) {
    if (!r || !r.d) continue;
    const acc = ensure(r.d);
    const cls = r.class;
    const n = Number(r.n) || 0;
    if (typeof cls === 'string' && Object.prototype.hasOwnProperty.call(acc.class, cls)) {
      acc.class[cls] += n;
    } else if (typeof cls === 'string' && cls.trim() !== '') {
      // Unexpected class value — surface it rather than silently drop.
      acc.class[cls] = (acc.class[cls] || 0) + n;
    }
  }

  for (const r of datacenterRows) {
    if (!r || !r.d) continue;
    ensure(r.d).coherent_datacenter += Number(r.n) || 0;
  }

  for (const r of impersonationRows) {
    if (!r || !r.d) continue;
    const acc = ensure(r.d);
    const key = bucketKey(r.operator);
    acc.impersonation_by_operator[key] = (acc.impersonation_by_operator[key] || 0) + (Number(r.n) || 0);
  }

  for (const r of signerRows) {
    if (!r || !r.d) continue;
    const acc = ensure(r.d);
    const key = bucketKey(r.wba_signer);
    acc.verified_signers[key] = (acc.verified_signers[key] || 0) + (Number(r.n) || 0);
  }

  for (const r of probeRows) {
    if (!r || !r.d) continue;
    ensure(r.d).probes += Number(r.n) || 0;
  }

  const days = [];
  for (const [date, acc] of byDay) {
    const cls = acc.class;
    const total = CLASS_KEYS.reduce((s, k) => s + (cls[k] || 0), 0) +
      // include any unexpected extra class keys in the total
      Object.entries(cls).reduce((s, [k, v]) => (CLASS_KEYS.includes(k) ? s : s + v), 0);
    const agent = cls.agent || 0;
    const impersonation = cls.impersonation_suspected || 0;
    days.push({
      date,
      classifier_version: classifierVersionFor(date),
      total,
      class: cls,
      coherent_datacenter: acc.coherent_datacenter,
      human_corrected: {
        v1_human: cls.human || 0,
        would_be_human_v0: (cls.human || 0) + acc.coherent_datacenter,
      },
      agents: {
        genuine: agent,
        impersonation,
        ratio: agent > 0 ? Math.round((impersonation / agent) * 10) / 10 : null,
      },
      impersonation_by_operator: sortedByCountDesc(acc.impersonation_by_operator),
      verified_signers: sortedByCountDesc(acc.verified_signers),
      probes: acc.probes,
    });
  }

  days.sort((a, b) => a.date.localeCompare(b.date));
  return days;
}

// ---------------------------------------------------------------------------
// Atomic write (tmp + rename), mirroring snapshot-catalog.js defensiveness.
// ---------------------------------------------------------------------------
function writeJsonAtomic(path, obj) {
  const tmp = path + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, JSON.stringify(obj, null, 2) + '\n');
  } finally {
    closeSync(fd);
  }
  renameWithRetry(tmp, path);
}

function renameWithRetry(src, dst, maxAttempts = 5) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      renameSync(src, dst);
      return;
    } catch (err) {
      lastErr = err;
      if (err.code !== 'EPERM' && err.code !== 'EACCES' && err.code !== 'EBUSY') throw err;
      const until = Date.now() + 50 * (attempt + 1);
      while (Date.now() < until) { /* brief spin — AV typically releases within ~50ms */ }
    }
  }
  try {
    if (existsSync(dst)) unlinkSync(dst);
    renameSync(src, dst);
  } catch {
    throw lastErr;
  }
}

// ---------------------------------------------------------------------------
// Main — fully guarded: never throws, never exits non-zero.
// ---------------------------------------------------------------------------
export async function main() {
  const { CF_ACCOUNT_ID, CF_API_TOKEN } = process.env;

  // Env check FIRST — so the tmp file is never even created when creds absent.
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.warn(
      '[snapshot-traffic] CF_ACCOUNT_ID and/or CF_API_TOKEN not set — skipping ' +
        '(existing data/traffic-snapshot.json left untouched). ' +
        'Run locally as: node --env-file=.env scripts/snapshot-traffic.js',
    );
    process.exit(0);
    return;
  }

  try {
    const url = queryUrl(CF_ACCOUNT_ID);
    const [cls, datacenter, impersonation, signers, probes] = await Promise.all([
      d1Query(url, CF_API_TOKEN, QUERIES.class),
      d1Query(url, CF_API_TOKEN, QUERIES.datacenter),
      d1Query(url, CF_API_TOKEN, QUERIES.impersonation),
      d1Query(url, CF_API_TOKEN, QUERIES.signers),
      d1Query(url, CF_API_TOKEN, QUERIES.probes),
    ]);

    const days = buildDayRows({
      class: rowsOf(cls),
      datacenter: rowsOf(datacenter),
      impersonation: rowsOf(impersonation),
      signers: rowsOf(signers),
      probes: rowsOf(probes),
    });

    if (days.length === 0) {
      console.warn(
        '[snapshot-traffic] D1 returned zero rows — leaving existing snapshot untouched.',
      );
      process.exit(0);
      return;
    }

    const snapshot = {
      generated_at: new Date().toISOString(),
      cutover: CUTOVER,
      days,
    };
    writeJsonAtomic(OUT_PATH, snapshot);

    const first = days[0].date;
    const last = days[days.length - 1].date;
    console.log(
      `[snapshot-traffic] wrote ${join('data', 'traffic-snapshot.json')}: ` +
        `${days.length} days (${first} → ${last}).`,
    );
  } catch (err) {
    // ANY failure — network, D1 non-success, parse — must NOT break the cron.
    // Do not print the token or any secret; err.message here is D1/HTTP detail.
    console.warn(
      `[snapshot-traffic] snapshot failed, leaving existing file untouched: ` +
        `${err && err.message ? err.message : err}`,
    );
    process.exit(0);
  }
}

// Only run main() when invoked as a script, not when imported by tests.
// Mirrors the snapshot-catalog.js invoked-as-script guard idiom.
const invokedAsScript = (() => {
  try {
    return (
      import.meta.url === fileURLToPath(`file://${process.argv[1]}`).replace(/\\/g, '/') ||
      fileURLToPath(import.meta.url) === process.argv[1]
    );
  } catch {
    return false;
  }
})();
if (invokedAsScript) {
  main();
}
