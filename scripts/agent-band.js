#!/usr/bin/env node
/**
 * scripts/agent-band.js — log-based hidden-agent band (quick-260905-esm).
 *
 * OFFLINE, READ-ONLY analysis of the Cloudflare D1 `request_log` table. Rolls up
 * the last N days of requests into per-session (ip_hash × user_agent × UTC-day)
 * aggregates ENTIRELY IN SQL, scores each session with the pure
 * ./lib/agent-band.js scorer, and prints a 5-section console report quantifying
 * "agents hiding in the human bucket." Also writes a tiny bounded aggregate
 * sidecar `data/agent-band.json`.
 *
 * ── PATTERN NOTES ───────────────────────────────────────────────────────────
 * - Node 22 ESM, global `fetch`, NO wrangler (workerd has no win32-arm64 build).
 *   D1 is reached over the HTTP /query REST endpoint, mirroring
 *   scripts/snapshot-traffic.js.
 * - READ-ONLY: only SELECT ... GROUP BY. `ip_hash` and `user_agent` appear ONLY
 *   in the GROUP BY — NEVER in the SELECT list, NEVER printed, NEVER written.
 *   The report and sidecar carry AGGREGATES ONLY (no per-session rows, no raw
 *   identifiers). No PII leaves the database.
 * - Robust: ANY failure (missing creds, network/fetch error, non-success D1
 *   response) logs a clear `[agent-band]` warning and process.exit(0). The
 *   script never throws and never exits non-zero.
 *
 * Usage:
 *   Local:  node --env-file=.env scripts/agent-band.js
 *   (optional --days=N ; default 7)
 *
 * Required env:
 *   CF_ACCOUNT_ID  — Cloudflare account id
 *   CF_API_TOKEN   — API token with D1 read permission (never logged)
 */

import { existsSync, openSync, writeSync, closeSync, renameSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scoreSession } from './lib/agent-band.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_PATH = join(ROOT, 'data', 'agent-band.json');

// claudeatlas-search-log — the same database wrangler.toml binds as DB. Copied
// verbatim from scripts/snapshot-traffic.js line 48 (a transposition typo would
// break every query, which would then just warn + exit 0 with no report).
const DATABASE_ID = 'd4e341fa-17d6-4069-8a00-3b6a8d698ab9';

// D1 caps rows per response (~10k). If a query returns exactly this many rows
// the result may be truncated — we warn (a follow-up would add LIMIT/OFFSET
// paging). Acceptable for a look-at-data first pass.
const D1_PAGE_CAP = 10000;

// ---------------------------------------------------------------------------
// D1 REST helper (verbatim from scripts/snapshot-traffic.js).
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

// A SELECT returns rows at json.result[0].results. Tolerate multiple blocks.
function rowsOf(json) {
  if (!json || !Array.isArray(json.result)) return [];
  return json.result.flatMap((r) => (r && Array.isArray(r.results) ? r.results : []));
}

// `timestamp` is stored in MILLISECONDS (Date.now()); divide by 1000 for strftime.
const DAY_EXPR = "strftime('%Y-%m-%d', timestamp/1000, 'unixepoch')";

// content = NOT asset. ASSET_TEST matches on the bare pathname (no query string).
const ASSET_TEST = `(
  path LIKE '/_astro/%' OR path LIKE '%.css' OR path LIKE '%.js' OR path LIKE '%.png'
  OR path LIKE '%.svg' OR path LIKE '%.ico' OR path LIKE '%.woff' OR path LIKE '%.woff2'
  OR path LIKE '%.jpg' OR path LIKE '%.jpeg' OR path LIKE '%.webp' OR path LIKE '/favicon%'
)`;

const ENDPOINT_TEST = `(
  path LIKE '/api/v1/search%' OR path = '/mcp' OR path LIKE '/agent/%'
  OR path LIKE '%llms.txt%' OR path LIKE '%.md'
)`;

/**
 * ONE per-session aggregation query. The table is ~1.7M rows — everything is
 * aggregated IN SQL; per-request rows are NEVER pulled. ip_hash and user_agent
 * appear ONLY in the GROUP BY, never in the SELECT list.
 */
export function buildSessionQuery(sinceMs) {
  return `SELECT
      ${DAY_EXPR} AS day,
      COUNT(*) AS total_requests,
      COUNT(DISTINCT path) AS distinct_paths,
      MAX(timestamp) - MIN(timestamp) AS span_ms,
      SUM(CASE WHEN ${ASSET_TEST} THEN 1 ELSE 0 END) AS asset_requests,
      COUNT(*) - SUM(CASE WHEN ${ASSET_TEST} THEN 1 ELSE 0 END) AS content_requests,
      SUM(CASE WHEN accept_header LIKE '%text/markdown%' THEN 1 ELSE 0 END) AS markdown_accept,
      SUM(CASE WHEN ${ENDPOINT_TEST} THEN 1 ELSE 0 END) AS agent_endpoint,
      SUM(CASE WHEN sec_fetch_coherent = 0 THEN 1 ELSE 0 END) AS sec_fetch_incoherent,
      MAX(CASE WHEN classifier_method = 'token_echo' THEN 1 ELSE 0 END) AS has_token_echo,
      MAX(CASE WHEN classifier_method = 'mcp' THEN 1 ELSE 0 END) AS has_mcp,
      MAX(class) AS session_class,
      MAX(asn_class) AS asn_class
    FROM request_log
    WHERE timestamp > ${sinceMs}
    GROUP BY day, ip_hash, user_agent`;
}

// ---------------------------------------------------------------------------
// Pure report assembly (aggregate-only; no per-session rows retained).
// ---------------------------------------------------------------------------
const AMBIGUOUS_CLASSES = new Set(['human', 'unknown']);

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 1000) / 10 : 0;
}

function emptyBands() {
  return { 'agent-shaped': 0, uncertain: 0, 'human-shaped': 0 };
}

/**
 * Reduce scored sessions into the report/sidecar aggregate object.
 * Retains NO per-session data — only counters.
 * @param {Array<{agg:object, res:object}>} scored
 */
export function assembleReport(scored) {
  const total_sessions = scored.length;

  const ambiguous = emptyBands();
  let ambiguousCount = 0;
  const component = {
    markdown: 0,
    endpoint: 0,
    asset_ratio_low: 0,
    incoherent: 0,
    one_fetch_each: 0,
  };

  const definiteAgent = emptyBands();
  let definiteAgentCount = 0;
  const clearlyHuman = emptyBands();
  let clearlyHumanCount = 0;

  for (const { agg, res } of scored) {
    const cls = typeof agg.session_class === 'string' ? agg.session_class : 'unknown';
    const s = res.signals;

    // Section 2 + 3: ambiguous pool (human / unknown class).
    if (AMBIGUOUS_CLASSES.has(cls)) {
      ambiguousCount++;
      ambiguous[res.band] = (ambiguous[res.band] || 0) + 1;
      if (s.markdown_rate > 0) component.markdown++;
      if (s.endpoint_rate > 0) component.endpoint++;
      if (s.asset_ratio < 0.1 && agg.content_requests >= 1) component.asset_ratio_low++;
      if (s.incoherent_rate > 0) component.incoherent++;
      if (s.distinct_paths >= 3 && s.total_requests <= s.distinct_paths + 1) component.one_fetch_each++;
    }

    // Section 4: calibration — definite agents (cooperative ground truth).
    if (agg.has_token_echo > 0 || agg.has_mcp > 0) {
      definiteAgentCount++;
      definiteAgent[res.band] = (definiteAgent[res.band] || 0) + 1;
    }

    // Section 4: calibration — clearly-human (asset-heavy, coherent, residential).
    if (
      s.asset_ratio >= 0.5 &&
      s.incoherent_rate === 0 &&
      agg.asn_class === 'isp_residential'
    ) {
      clearlyHumanCount++;
      clearlyHuman[res.band] = (clearlyHuman[res.band] || 0) + 1;
    }
  }

  // Section 5: estimated hidden-agent range (agent-shaped + half the uncertain bucket).
  const agent_shaped = ambiguous['agent-shaped'];
  const range_low = agent_shaped;
  const range_high = agent_shaped + Math.round(ambiguous.uncertain / 2);

  return {
    total_sessions,
    ambiguous_pool: {
      count: ambiguousCount,
      bands: ambiguous,
      pct: {
        'agent-shaped': pct(ambiguous['agent-shaped'], ambiguousCount),
        uncertain: pct(ambiguous.uncertain, ambiguousCount),
        'human-shaped': pct(ambiguous['human-shaped'], ambiguousCount),
      },
    },
    component_breakdown: {
      count: ambiguousCount,
      markdown: { n: component.markdown, pct: pct(component.markdown, ambiguousCount) },
      endpoint: { n: component.endpoint, pct: pct(component.endpoint, ambiguousCount) },
      asset_ratio_low: { n: component.asset_ratio_low, pct: pct(component.asset_ratio_low, ambiguousCount) },
      incoherent: { n: component.incoherent, pct: pct(component.incoherent, ambiguousCount) },
      one_fetch_each: { n: component.one_fetch_each, pct: pct(component.one_fetch_each, ambiguousCount) },
    },
    calibration: {
      definite_agent: { count: definiteAgentCount, bands: definiteAgent },
      clearly_human: { count: clearlyHumanCount, bands: clearlyHuman },
    },
    estimated_hidden_agents: { agent_shaped, range_low, range_high },
  };
}

// ---------------------------------------------------------------------------
// Console report (all 5 sections).
// ---------------------------------------------------------------------------
function printReport(report, window) {
  const { from, to, days } = window;
  const L = (s) => console.log(s);

  L('');
  L('══════════════════════════════════════════════════════════════════');
  L('  LOG-BASED HIDDEN-AGENT BAND  (offline, read-only D1 analysis)');
  L('══════════════════════════════════════════════════════════════════');

  // Section 1 — window + totals.
  L('');
  L(`[1] Window: ${from} → ${to}  (${days} day${days === 1 ? '' : 's'})`);
  L(`    Total sessions scored: ${report.total_sessions}`);

  // Section 2 — band distribution over the ambiguous pool.
  const ap = report.ambiguous_pool;
  L('');
  L(`[2] Band distribution over the AMBIGUOUS POOL (class ∈ {human, unknown})`);
  L(`    Pool size: ${ap.count} sessions`);
  L(`    agent-shaped : ${ap.bands['agent-shaped']}  (${ap.pct['agent-shaped']}%)   ← "hidden in the human bucket"`);
  L(`    uncertain    : ${ap.bands.uncertain}  (${ap.pct.uncertain}%)`);
  L(`    human-shaped : ${ap.bands['human-shaped']}  (${ap.pct['human-shaped']}%)`);

  // Section 3 — component-signal breakdown.
  const cb = report.component_breakdown;
  L('');
  L(`[3] Component-signal breakdown of the ambiguous pool (${cb.count} sessions)`);
  L(`    markdown Accept > 0        : ${cb.markdown.n}  (${cb.markdown.pct}%)`);
  L(`    agent-endpoint hits        : ${cb.endpoint.n}  (${cb.endpoint.pct}%)`);
  L(`    asset_ratio < 0.1 w/content: ${cb.asset_ratio_low.n}  (${cb.asset_ratio_low.pct}%)`);
  L(`    incoherent Sec-Fetch       : ${cb.incoherent.n}  (${cb.incoherent.pct}%)`);
  L(`    one-fetch-each sweep       : ${cb.one_fetch_each.n}  (${cb.one_fetch_each.pct}%)`);

  // Section 4 — calibration check.
  const da = report.calibration.definite_agent;
  const ch = report.calibration.clearly_human;
  L('');
  L(`[4] Calibration check`);
  L(`    DEFINITE agents (token_echo OR mcp) — MUST be agent-shaped:`);
  L(`      count ${da.count}  →  agent-shaped ${da.bands['agent-shaped']}, uncertain ${da.bands.uncertain}, human-shaped ${da.bands['human-shaped']}`);
  L(`    CLEARLY-human (asset_ratio≥0.5, coherent, residential) — should be human-shaped:`);
  L(`      count ${ch.count}  →  agent-shaped ${ch.bands['agent-shaped']}, uncertain ${ch.bands.uncertain}, human-shaped ${ch.bands['human-shaped']}`);

  // Section 5 — estimated hidden-agent range.
  const eh = report.estimated_hidden_agents;
  L('');
  L(`[5] Estimated hidden agents in the human bucket`);
  L(`    agent-shaped: ${eh.agent_shaped}`);
  L(`    range (incl. half the uncertain bucket): ${eh.range_low}–${eh.range_high} sessions`);
  L('');
}

// ---------------------------------------------------------------------------
// Atomic write (tmp + rename), mirroring snapshot-traffic.js.
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

  // Optional --days=N (default 7).
  let days = 7;
  for (const a of process.argv.slice(2)) {
    const m = /^--days=(\d+)$/.exec(a);
    if (m) days = Math.max(1, parseInt(m[1], 10));
  }

  // Env check FIRST — never create the tmp file when creds are absent.
  if (!CF_ACCOUNT_ID || !CF_API_TOKEN) {
    console.warn(
      '[agent-band] CF_ACCOUNT_ID and/or CF_API_TOKEN not set — skipping ' +
        '(existing data/agent-band.json left untouched). ' +
        'Run locally as: node --env-file=.env scripts/agent-band.js',
    );
    process.exit(0);
    return;
  }

  try {
    const now = Date.now();
    const sinceMs = now - days * 86400 * 1000;
    const from = new Date(sinceMs).toISOString().slice(0, 10);
    const to = new Date(now).toISOString().slice(0, 10);
    const windowMeta = { from, to, days };

    const url = queryUrl(CF_ACCOUNT_ID);
    const json = await d1Query(url, CF_API_TOKEN, buildSessionQuery(sinceMs));
    const rows = rowsOf(json);

    if (rows.length >= D1_PAGE_CAP) {
      console.warn(
        `[agent-band] query returned ${rows.length} rows (>= D1 page cap ${D1_PAGE_CAP}); ` +
          'results may be truncated — consider adding LIMIT/OFFSET paging as a follow-up.',
      );
    }

    // Score every session; retain only {agg, res} transiently for assembly.
    const scored = rows.map((row) => {
      const agg = {
        total_requests: Number(row.total_requests) || 0,
        distinct_paths: Number(row.distinct_paths) || 0,
        span_ms: Number(row.span_ms) || 0,
        content_requests: Number(row.content_requests) || 0,
        asset_requests: Number(row.asset_requests) || 0,
        markdown_accept: Number(row.markdown_accept) || 0,
        agent_endpoint: Number(row.agent_endpoint) || 0,
        sec_fetch_incoherent: Number(row.sec_fetch_incoherent) || 0,
        has_token_echo: Number(row.has_token_echo) || 0,
        has_mcp: Number(row.has_mcp) || 0,
        session_class: typeof row.session_class === 'string' ? row.session_class : 'unknown',
        asn_class: typeof row.asn_class === 'string' ? row.asn_class : 'unknown',
      };
      return { agg, res: scoreSession(agg) };
    });

    const report = assembleReport(scored);

    printReport(report, windowMeta);

    const sidecar = {
      generated_at: new Date().toISOString(),
      window: windowMeta,
      total_sessions: report.total_sessions,
      ambiguous_pool: report.ambiguous_pool,
      component_breakdown: report.component_breakdown,
      calibration: report.calibration,
      estimated_hidden_agents: report.estimated_hidden_agents,
    };
    writeJsonAtomic(OUT_PATH, sidecar);
    console.log(`[agent-band] wrote ${join('data', 'agent-band.json')} (aggregate metrics only).`);
  } catch (err) {
    // ANY failure must NOT throw / exit non-zero. Do not print token or secrets.
    console.warn(
      `[agent-band] analysis failed, leaving existing file untouched: ` +
        `${err && err.message ? err.message : err}`,
    );
    process.exit(0);
  }
}

// Only run main() when invoked as a script, not when imported by tests.
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
