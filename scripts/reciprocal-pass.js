#!/usr/bin/env node
/**
 * scripts/reciprocal-pass.js — Reciprocal Pass v1 polite runner
 * (quick-260908-045, RP-03/RP-04/RP-05).
 *
 * A declared-UA "good bot" (a fixed-probe crawler — no model in the loop; the
 * scope doc's "good-agent" framing refers to what the web sees, i.e. a declared
 * automated client) that makes ONE read-only, meta-only pass over the
 * domains in data/reciprocal-targets.json and records how each site treats a
 * polite self-declared bot: block / challenge / toll behaviour, robots.txt
 * posture toward AI bots, markdown negotiation, agent-web standards adoption
 * (/llms.txt etc.), homepage bloat, JSON-LD presence, a light cloaking diff and
 * whether THEY publish a Web Bot Auth key directory. Scope + rationale:
 * docs/reciprocal-agent-pass-scope.md. Public identity: https://claudeatlas.com/bot/
 *
 * Getting blocked is DATA, not failure. Politeness is the whole posture:
 *
 *   - robots.txt is the FIRST request to every target; every later path is
 *     gated by isAllowed() (a ClaudeAtlasBot group, else *). Disallowed paths
 *     are never fetched — they are recorded as result 'robots_disallowed'.
 *     robots 5xx / timeout → treated as disallow-all (RFC 9309 conservative).
 *     The browser-UA cloaking comparison is ALSO skipped when robots disallows
 *     us — we never evade robots by switching UA.
 *   - GET only. Declared UA on every agent request. ≥3000 ms between the
 *     START of consecutive requests to one host (redirect hops included, via a
 *     per-host promise chain), at most 3 hosts in flight, 15 s abort per hop,
 *     ≤5 redirects, ≤512 KB read per response, one retry ONLY on a network
 *     error — never on any HTTP status.
 *   - Nothing but classification inputs are kept: statuses, a handful of
 *     headers, byte counts, robots directives, JSON-LD counts. No page text is
 *     persisted.
 *
 * ── PATTERN NOTES ───────────────────────────────────────────────────────────
 * - Node 22 ESM, global `fetch`, NO wrangler, NO env vars required. Standalone
 *   script (win32-arm64 fine) — the live worker is untouched.
 * - ALL decision logic is imported from ./lib/reciprocal-probe.js (pure,
 *   unit-tested). This file contains only I/O + scheduling.
 * - Output is written ONCE, at the end, via tmp+rename (writeJsonAtomic +
 *   renameWithRetry mirrored from scripts/snapshot-traffic.js) — a Ctrl-C
 *   mid-run never leaves a partial file.
 * - main() never throws and never exits non-zero: any failure logs a
 *   `[reciprocal-pass]` warning and exits 0.
 * - Banned-pattern lint: whole-file allowlisted in check-banned-patterns.js —
 *   the target list is a ~27-entry committed JSON and the output sidecar is
 *   structurally bounded (targets × fixed probe set, ~27 × few KB).
 *
 * Usage:
 *   node scripts/reciprocal-pass.js                       full pass, all targets
 *   node scripts/reciprocal-pass.js --only claudeatlas.com  control smoke (comma-separable)
 *   node scripts/reciprocal-pass.js --limit 5             first N targets (after --only)
 *   node scripts/reciprocal-pass.js --report-only         re-render the report, zero network
 *   node scripts/reciprocal-pass.js --out path.json       alternate dataset path
 */

import {
  existsSync,
  readFileSync,
  openSync,
  writeSync,
  closeSync,
  renameSync,
  unlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AGENT_UA,
  BROWSER_UA,
  WELL_KNOWN_PATHS,
  SIGNATURES_DIRECTORY_PATH,
  BODY_CAP_BYTES,
  POLICY,
  analyzeRobots,
  isAllowed,
  summarizeResponse,
  analyzeHtml,
  cloakingDiff,
  checkWellKnownBody,
  isMarkdownNegotiated,
  aggregate,
  renderReport,
} from './lib/reciprocal-probe.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TARGETS_PATH = join(ROOT, 'data', 'reciprocal-targets.json');
const DEFAULT_OUT_PATH = join(ROOT, 'data', 'reciprocal-pass.json');
const REPORT_PATH = join(ROOT, 'docs', 'reciprocal-pass-report.md');

const SCHEMA_VERSION = 1;
const SNIPPET_BYTES = 16 * 1024; // decoded prefix kept in memory for classification only
const LOG = '[reciprocal-pass]';

// Accept headers per probe kind. Explicit so the /bot page can describe them.
const ACCEPT_HTML = 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';
const ACCEPT_MARKDOWN = 'text/markdown, text/html;q=0.9';
const ACCEPT_ROBOTS = 'text/plain, */*;q=0.5';
const ACCEPT_WELL_KNOWN = 'application/json, text/plain, text/markdown, */*;q=0.5';

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const opts = { only: null, limit: null, reportOnly: false, out: DEFAULT_OUT_PATH };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--only' && argv[i + 1]) {
      opts.only = argv[++i].split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (a.startsWith('--only=')) {
      opts.only = a.slice(7).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } else if (a === '--limit' && argv[i + 1]) {
      opts.limit = Number(argv[++i]);
    } else if (a.startsWith('--limit=')) {
      opts.limit = Number(a.slice(8));
    } else if (a === '--report-only') {
      opts.reportOnly = true;
    } else if (a === '--out' && argv[i + 1]) {
      opts.out = argv[++i];
    } else if (a.startsWith('--out=')) {
      opts.out = a.slice(6);
    }
  }
  if (!Number.isFinite(opts.limit) || opts.limit <= 0) opts.limit = null;
  return opts;
}

// ---------------------------------------------------------------------------
// Target list (tiny committed JSON — whole-file lint allowlisted).
// ---------------------------------------------------------------------------
function loadTargets(opts) {
  const raw = JSON.parse(readFileSync(TARGETS_PATH, 'utf-8'));
  let targets = Array.isArray(raw && raw.targets) ? raw.targets : [];
  targets = targets.filter((t) => t && typeof t.domain === 'string' && t.domain.trim());
  if (opts.only) targets = targets.filter((t) => opts.only.includes(t.domain.toLowerCase()));
  if (opts.limit) targets = targets.slice(0, opts.limit);
  return targets;
}

// ---------------------------------------------------------------------------
// Per-host politeness: a promise chain per host serialises reservations so
// two targets that redirect onto the same host can never race past the gap.
// ---------------------------------------------------------------------------
const hostChains = new Map();
const hostLastStart = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function reserveHostSlot(host) {
  const key = String(host || '').toLowerCase();
  const prev = hostChains.get(key) || Promise.resolve();
  const next = prev.then(async () => {
    const last = hostLastStart.get(key);
    if (last !== undefined) {
      const wait = POLICY.min_host_spacing_ms - (Date.now() - last);
      if (wait > 0) await sleep(wait);
    }
    hostLastStart.set(key, Date.now());
  });
  // Keep the chain alive even if a consumer rejects.
  hostChains.set(key, next.catch(() => {}));
  return next;
}

// ---------------------------------------------------------------------------
// Fetch with cap: GET, manual redirects, timeout per hop, capped body read,
// retry once on network error only.
// ---------------------------------------------------------------------------
function headersToObject(h) {
  const out = {};
  try {
    for (const [k, v] of h) out[k.toLowerCase()] = v;
  } catch {
    /* ignore */
  }
  return out;
}

function isNetworkError(err) {
  if (!err) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  if (err instanceof TypeError) return true; // undici wraps connection failures
  const code = err.code || (err.cause && err.cause.code);
  return typeof code === 'string';
}

function errorLabel(err) {
  if (!err) return 'unknown';
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'timeout';
  const code = err.code || (err.cause && err.cause.code);
  if (code) return String(code);
  return err.message ? String(err.message).slice(0, 120) : String(err);
}

async function readCapped(res, { keepAll = false } = {}) {
  const body = res.body;
  if (!body || typeof body.getReader !== 'function') return { read: 0, truncated: false, text: '' };
  const reader = body.getReader();
  const chunks = [];
  let kept = 0;
  let total = 0;
  let truncated = false;
  const keepLimit = keepAll ? BODY_CAP_BYTES : SNIPPET_BYTES;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (kept < keepLimit) {
        const slice = value.byteLength + kept > keepLimit ? value.subarray(0, keepLimit - kept) : value;
        chunks.push(slice);
        kept += slice.byteLength;
      }
      if (total >= BODY_CAP_BYTES) {
        truncated = true;
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch (err) {
    // A mid-body network failure still leaves us with headers + partial bytes.
    truncated = true;
    try { await reader.cancel(); } catch { /* ignore */ }
    if (total === 0) throw err;
  }
  const buf = new Uint8Array(kept);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { read: total, truncated, text: new TextDecoder('utf-8', { fatal: false }).decode(buf) };
}

async function fetchOnce(url, headers) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), POLICY.timeout_ms);
  try {
    const res = await fetch(url, {
      method: POLICY.method,
      headers,
      redirect: 'manual',
      signal: ac.signal,
    });
    return { res, release: () => clearTimeout(timer), signal: ac.signal, timer };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

/**
 * GET `url` politely. Returns
 * { status, headers, bytes, bytesBasis, bytesTruncated, redirectCount, finalUrl,
 *   bodySnippet, text, error, requests }.
 * Never throws — network failures come back as { status: null, error }.
 */
async function fetchCapped(url, { headers, keepAll = false }) {
  let current = url;
  let redirectCount = 0;
  let requests = 0;

  for (;;) {
    let host;
    try {
      const u = new URL(current);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('non-http redirect');
      host = u.host;
    } catch (err) {
      return { status: null, headers: {}, bytes: null, bytesBasis: null, bytesTruncated: false, redirectCount, finalUrl: current, bodySnippet: '', text: '', error: 'bad_url:' + errorLabel(err), requests };
    }

    let handle = null;
    let lastErr = null;
    for (let attempt = 0; attempt <= POLICY.retry_on_network_error; attempt++) {
      await reserveHostSlot(host);
      requests += 1;
      try {
        handle = await fetchOnce(current, headers);
        break;
      } catch (err) {
        lastErr = err;
        if (!isNetworkError(err)) break;
      }
    }
    if (!handle) {
      return { status: null, headers: {}, bytes: null, bytesBasis: null, bytesTruncated: false, redirectCount, finalUrl: current, bodySnippet: '', text: '', error: errorLabel(lastErr), requests };
    }

    const { res, release } = handle;
    const hdrs = headersToObject(res.headers);
    const location = hdrs.location;

    if (res.status >= 300 && res.status < 400 && location) {
      // Drain without reading: cancel the body, then follow (or give up).
      try { await res.body?.cancel(); } catch { /* ignore */ }
      release();
      if (redirectCount >= POLICY.max_redirects) {
        return { status: res.status, headers: hdrs, bytes: null, bytesBasis: null, bytesTruncated: false, redirectCount, finalUrl: current, bodySnippet: '', text: '', error: 'redirect_budget', requests };
      }
      redirectCount += 1;
      try {
        current = new URL(location, current).href;
      } catch {
        return { status: res.status, headers: hdrs, bytes: null, bytesBasis: null, bytesTruncated: false, redirectCount, finalUrl: current, bodySnippet: '', text: '', error: 'bad_location', requests };
      }
      continue;
    }

    let read;
    try {
      read = await readCapped(res, { keepAll });
    } catch (err) {
      release();
      return { status: res.status, headers: hdrs, bytes: null, bytesBasis: null, bytesTruncated: true, redirectCount, finalUrl: current, bodySnippet: '', text: '', error: 'body:' + errorLabel(err), requests };
    }
    release();

    const cl = Number(hdrs['content-length']);
    const hasCl = Number.isFinite(cl) && cl >= 0 && hdrs['content-length'] !== undefined;
    return {
      status: res.status,
      headers: hdrs,
      bytes: hasCl ? cl : read.read,
      bytesBasis: hasCl ? 'content-length' : 'read',
      bytesTruncated: read.truncated && !hasCl,
      redirectCount,
      finalUrl: current,
      bodySnippet: read.text.slice(0, SNIPPET_BYTES),
      text: read.text,
      error: null,
      requests,
    };
  }
}

// ---------------------------------------------------------------------------
// Probe one target
// ---------------------------------------------------------------------------
function agentHeaders(accept) {
  return {
    'user-agent': AGENT_UA,
    accept,
    'accept-language': 'en',
    'accept-encoding': 'gzip, br',
  };
}

function browserHeaders() {
  return {
    'user-agent': BROWSER_UA,
    accept: ACCEPT_HTML,
    'accept-language': 'en',
    'accept-encoding': 'gzip, br',
  };
}

function disallowedSummary() {
  return { ...summarizeResponse({}), result: 'robots_disallowed', status: null, error: null };
}

function disallowedWellKnown() {
  return { result: 'robots_disallowed', status: null, content_type: null, bytes: null, plausible: false };
}

function errorWellKnown(msg) {
  return { result: 'error', status: null, content_type: null, bytes: null, plausible: false, error: msg };
}

function stripParsed(robots) {
  const { parsed, ...rest } = robots || {};
  return rest;
}

async function probeTarget(t) {
  const start = Date.now();
  const domain = t.domain.trim().toLowerCase();
  const base = `https://${domain}`;
  const statuses = [];
  let requests = 0;

  const rec = {
    domain,
    operator: t.operator ?? null,
    tier: t.tier ?? null,
    source: t.source ?? null,
    note: t.note ?? null,
    robots: null,
    homepage: null,
    markdown: null,
    browser: null,
    cloaking: null,
    well_known: {},
    toll: false,
    signs_requests: false,
    requests_made: 0,
    duration_ms: 0,
  };

  const track = (r) => {
    requests += r.requests || 0;
    if (Number.isFinite(r.status)) statuses.push(r.status);
    return r;
  };

  try {
    // (a) robots.txt FIRST — with the declared UA.
    const r = track(await fetchCapped(base + '/robots.txt', { headers: agentHeaders(ACCEPT_ROBOTS), keepAll: true }));
    const robots = analyzeRobots({ status: r.status, text: r.text, error: r.error });
    rec.robots = { ...stripParsed(robots), redirect_count: r.redirectCount, final_host: summarizeResponse(r).final_host };
    const parsed = robots.parsed;

    // (b) homepage × 3 — only if robots allows us at '/'.
    if (isAllowed(parsed, '/')) {
      const h = track(await fetchCapped(base + '/', { headers: agentHeaders(ACCEPT_HTML) }));
      rec.homepage = { ...summarizeResponse(h), bytes_basis: h.bytesBasis, ...analyzeHtml(h.bodySnippet) };

      const m = track(await fetchCapped(base + '/', { headers: agentHeaders(ACCEPT_MARKDOWN) }));
      const ms = summarizeResponse(m);
      rec.markdown = {
        result: ms.result,
        status: ms.status,
        content_type: ms.content_type,
        negotiated: ms.result === 'allowed' && isMarkdownNegotiated(ms.content_type),
        bytes: ms.bytes,
      };

      const b = track(await fetchCapped(base + '/', { headers: browserHeaders() }));
      const bs = summarizeResponse(b);
      rec.browser = { result: bs.result, status: bs.status, bytes: bs.bytes };
    } else {
      rec.homepage = { ...disallowedSummary(), bytes_basis: null, jsonld_count: 0, has_schema_org: false };
      rec.markdown = { result: 'robots_disallowed', status: null, content_type: null, negotiated: false, bytes: null };
      rec.browser = { result: 'robots_disallowed', status: null, bytes: null };
    }
    rec.cloaking = cloakingDiff(rec.homepage, rec.browser);

    // (c) well-known probe set — each path individually gated by robots.
    for (const wk of WELL_KNOWN_PATHS) {
      if (!isAllowed(parsed, wk.path)) {
        rec.well_known[wk.path] = disallowedWellKnown();
        continue;
      }
      const w = track(await fetchCapped(base + wk.path, { headers: agentHeaders(ACCEPT_WELL_KNOWN) }));
      const ws = summarizeResponse(w);
      rec.well_known[wk.path] = {
        result: ws.result,
        status: ws.status,
        content_type: ws.content_type,
        bytes: ws.bytes,
        plausible: ws.result === 'allowed' && checkWellKnownBody(wk.expect, ws.content_type, w.bodySnippet),
      };
    }
  } catch (err) {
    const msg = errorLabel(err);
    console.warn(`${LOG} ${domain}: probe threw — recorded as error (${msg})`);
    if (!rec.robots) rec.robots = { ...stripParsed(analyzeRobots({ error: msg })), redirect_count: 0, final_host: null };
    if (!rec.homepage) rec.homepage = { ...summarizeResponse({ error: msg }), bytes_basis: null, jsonld_count: 0, has_schema_org: false };
    else if (rec.homepage.result === 'allowed') rec.homepage = { ...rec.homepage, result: 'error', error: msg };
    if (!rec.markdown) rec.markdown = { result: 'error', status: null, content_type: null, negotiated: false, bytes: null };
    if (!rec.browser) rec.browser = { result: 'error', status: null, bytes: null };
    if (!rec.cloaking) rec.cloaking = cloakingDiff(rec.homepage, rec.browser);
    for (const wk of WELL_KNOWN_PATHS) if (!rec.well_known[wk.path]) rec.well_known[wk.path] = errorWellKnown(msg);
  }

  // (d) derived flags.
  rec.toll = statuses.includes(402);
  const sig = rec.well_known[SIGNATURES_DIRECTORY_PATH];
  rec.signs_requests = !!(sig && sig.result === 'allowed' && sig.plausible === true);
  rec.requests_made = requests;
  rec.duration_ms = Date.now() - start;

  const h = rec.homepage;
  const llms = rec.well_known['/llms.txt'];
  console.log(
    `${LOG} ${domain} → ${h.result} (${h.status ?? '-'}${h.server ? ', ' + h.server : ''}) ` +
      `md:${rec.markdown && rec.markdown.negotiated ? 'yes' : 'no'} ` +
      `llms:${llms && llms.result === 'allowed' && llms.plausible ? '✓' : '✗'} ` +
      `signs:${rec.signs_requests ? '✓' : '✗'} ` +
      `${requests} req ${(rec.duration_ms / 1000).toFixed(1)}s`,
  );
  return rec;
}

// ---------------------------------------------------------------------------
// Worker pool: POLICY.concurrency targets (= distinct hosts) in flight.
// ---------------------------------------------------------------------------
async function runPool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, size) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Atomic write (tmp + rename) — verbatim from scripts/snapshot-traffic.js.
// ---------------------------------------------------------------------------
function writeJsonAtomic(path, obj) {
  writeTextAtomic(path, JSON.stringify(obj, null, 2) + '\n');
}

function writeTextAtomic(path, text) {
  const tmp = path + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, text);
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
// Console summary
// ---------------------------------------------------------------------------
function pct(x) {
  return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—';
}

function printSummary(pass, outPath) {
  const a = pass.aggregate;
  console.log(`${LOG} ── summary ──────────────────────────────────────────`);
  console.log(`${LOG} targets: ${a.targets_total} (answered ${a.non_error_count}; error ${a.by_result.error}; robots_disallowed ${a.by_result.robots_disallowed})`);
  console.log(`${LOG} block_rate: ${pct(a.block_rate)}  allowed_rate: ${pct(a.allowed_rate)}  (allowed ${a.by_result.allowed} / blocked ${a.by_result.blocked} / challenged ${a.by_result.challenged})`);
  console.log(`${LOG} challenged: ${a.challenged_count}  toll: ${a.toll_count}  cloaking: ${a.cloaking_count}  jsonld: ${a.jsonld_present_count}`);
  console.log(`${LOG} markdown_negotiation_rate: ${pct(a.markdown_negotiation_rate)}  signers: ${a.signers_count}`);
  console.log(`${LOG} llms.txt: ${a.standards['/llms.txt'].ok_count}  robots present: ${a.robots.present_count}  names AI bots: ${a.robots.names_ai_bots_count}  disallows us: ${a.robots.disallows_us_count}`);
  console.log(`${LOG} control_passes: ${a.control_passes}`);
  console.log(`${LOG} wrote ${outPath}`);
  console.log(`${LOG} wrote ${REPORT_PATH}`);
}

// ---------------------------------------------------------------------------
// Main — fully guarded: never throws, never exits non-zero.
// ---------------------------------------------------------------------------
export async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  try {
    if (opts.reportOnly) {
      if (!existsSync(opts.out)) {
        console.warn(`${LOG} --report-only: ${opts.out} does not exist — nothing to render.`);
        process.exit(0);
        return;
      }
      const pass = JSON.parse(readFileSync(opts.out, 'utf-8'));
      writeTextAtomic(REPORT_PATH, renderReport(pass));
      console.log(`${LOG} re-rendered ${REPORT_PATH} from ${opts.out} (${Array.isArray(pass.targets) ? pass.targets.length : 0} targets, zero network).`);
      return;
    }

    const targets = loadTargets(opts);
    if (targets.length === 0) {
      console.warn(`${LOG} no targets selected (check --only / data/reciprocal-targets.json) — nothing written.`);
      process.exit(0);
      return;
    }

    console.log(
      `${LOG} ${targets.length} target(s) · UA "${AGENT_UA}" · ≥${POLICY.min_host_spacing_ms}ms/host · ` +
        `concurrency ${POLICY.concurrency} · ${POLICY.timeout_ms}ms timeout · ≤${POLICY.max_redirects} redirects · ` +
        `≤${Math.round(BODY_CAP_BYTES / 1024)}KB read · GET only`,
    );
    const runAt = new Date().toISOString();
    const results = await runPool(targets, POLICY.concurrency, probeTarget);

    const pass = {
      schema_version: SCHEMA_VERSION,
      run_at: runAt,
      agent: {
        ua: AGENT_UA,
        policy: POLICY,
        probe_paths: WELL_KNOWN_PATHS.map((w) => w.path),
      },
      targets: results,
      aggregate: aggregate(results),
    };

    writeJsonAtomic(opts.out, pass);
    writeTextAtomic(REPORT_PATH, renderReport(pass));
    printSummary(pass, opts.out);
  } catch (err) {
    console.warn(`${LOG} pass failed, existing outputs left untouched: ${err && err.message ? err.message : err}`);
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
