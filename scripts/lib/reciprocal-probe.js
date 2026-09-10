/**
 * scripts/lib/reciprocal-probe.js — Reciprocal Pass v1 pure probe logic
 * (quick-260908-045, RP-01).
 *
 * PURE MODULE: zero imports, zero I/O, never throws. Every exported function is
 * defensive on null/undefined input. The runner (scripts/reciprocal-pass.js)
 * owns fetch + scheduling; ALL classification / decision logic lives here so it
 * is unit-testable without network (scripts/lib/reciprocal-probe.test.js).
 *
 * Scope: docs/reciprocal-agent-pass-scope.md. This is the declared-UA v1 — no
 * request signing (v2).
 *
 * Also imported by src/pages/bot.astro at build time so the public /bot page
 * can never drift from the runner's UA / policy / probe set.
 *
 * Robots matcher limitation (documented): RFC 9309 longest-match over prefix
 * rules with `*` wildcard and `$` end anchor. Percent-decoding / UTF-8
 * normalisation of paths is NOT implemented — every probe path in this tool
 * is plain ASCII, so it is not needed for v1.
 */

// ---------------------------------------------------------------------------
// Constants — the identity + policy of the agent. Hand-extendable.
// ---------------------------------------------------------------------------

export const AGENT_UA = 'ClaudeAtlasBot/1.0 (+https://claudeatlas.com/bot)';
export const AGENT_TOKEN = 'ClaudeAtlasBot'; // robots.txt User-agent token we match on
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';

// Fixed probe set, in this order. `expect` drives checkWellKnownBody.
export const WELL_KNOWN_PATHS = [
  { path: '/llms.txt', expect: 'text' },
  { path: '/llms-full.txt', expect: 'text' },
  { path: '/.well-known/agents.json', expect: 'json' },
  { path: '/.well-known/mcp/server-card.json', expect: 'json' },
  { path: '/.well-known/http-message-signatures-directory', expect: 'json' }, // "do THEY sign?"
  { path: '/ai.txt', expect: 'text' },
];

export const SIGNATURES_DIRECTORY_PATH = '/.well-known/http-message-signatures-directory';

// AI crawler tokens we look for in robots.txt User-agent lines.
export const AI_BOT_NAMES = [
  'GPTBot',
  'ClaudeBot',
  'Claude-Web',
  'anthropic-ai',
  'PerplexityBot',
  'Google-Extended',
  'Applebot-Extended',
  'Bytespider',
  'CCBot',
  'meta-externalagent',
  'Amazonbot',
  'OAI-SearchBot',
  'cohere-ai',
  'Meta-ExternalFetcher',
  'Diffbot',
];

export const BODY_CAP_BYTES = 512 * 1024;

export const POLICY = {
  min_host_spacing_ms: 3000,
  concurrency: 3,
  timeout_ms: 15000,
  max_redirects: 5,
  retry_on_network_error: 1,
  method: 'GET',
};

// Body markers of an interstitial challenge (Cloudflare, Akamai, generic
// captcha). Only consulted on 403/503. Extend as new vendors show up.
export const CHALLENGE_BODY_RE =
  /Just a moment|cf-chl|Attention Required|captcha|Access Denied.{0,200}Reference #/is;

const CLOAKING_SIZE_THRESHOLD = 0.3;
const RESULT_KEYS = ['allowed', 'blocked', 'challenged', 'toll', 'error', 'robots_disallowed'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isStr(v) {
  return typeof v === 'string';
}

function lower(v) {
  return isStr(v) ? v.toLowerCase() : '';
}

function round3(x) {
  return Math.round(x * 1000) / 1000;
}

function rate(num, den) {
  return den > 0 ? round3(num / den) : null;
}

function hdr(headers, name) {
  if (!headers || typeof headers !== 'object') return null;
  const v = headers[name];
  if (isStr(v)) return v;
  if (Array.isArray(v) && v.length) return String(v[0]);
  return null;
}

function looksHtml(s) {
  return isStr(s) && /^\s*(<!doctype\s+html|<html)/i.test(s);
}

// ---------------------------------------------------------------------------
// robots.txt — RFC 9309 semantics, kept small
// ---------------------------------------------------------------------------

/**
 * Parse robots.txt text into groups + sitemaps + Content-Signal.
 * - lines split on \r?\n, '#' comments stripped, trimmed
 * - directive names case-insensitive
 * - consecutive User-agent lines share one group
 * - empty `Disallow:` is dropped (= allow all)
 * - `Content-Signal:` captured verbatim (first occurrence)
 */
export function parseRobots(text) {
  const out = { groups: [], sitemaps: [], content_signal: null };
  if (!isStr(text)) return out;

  let current = null;
  let accumulatingAgents = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const hash = rawLine.indexOf('#');
    const line = (hash >= 0 ? rawLine.slice(0, hash) : rawLine).trim();
    if (!line) continue;
    const m = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const directive = m[1].toLowerCase();
    const value = m[2].trim();

    switch (directive) {
      case 'user-agent':
        if (!accumulatingAgents || !current) {
          current = { agents: [], allow: [], disallow: [] };
          out.groups.push(current);
          accumulatingAgents = true;
        }
        if (value) current.agents.push(value);
        break;
      case 'allow':
        accumulatingAgents = false;
        if (current && value) current.allow.push(value);
        break;
      case 'disallow':
        accumulatingAgents = false;
        if (current && value) current.disallow.push(value);
        break;
      case 'sitemap':
        // Non-group directive per RFC 9309; does not close the group.
        if (value) out.sitemaps.push(value);
        break;
      case 'content-signal':
        accumulatingAgents = false;
        if (out.content_signal === null && value) out.content_signal = value;
        break;
      default:
        // crawl-delay, host, etc. — end user-agent accumulation, otherwise ignored.
        accumulatingAgents = false;
    }
  }
  return out;
}

/**
 * Pick the group that governs `token`: a group naming the token (exact,
 * case-insensitive) wins; else the '*' group; else null (= allow all).
 * Multiple groups naming the same token are merged (RFC 9309 §2.2.1).
 */
export function selectGroup(robots, token = AGENT_TOKEN) {
  if (!robots || !Array.isArray(robots.groups) || robots.groups.length === 0) return null;
  const want = lower(token);
  const merge = (groups) => {
    if (groups.length === 0) return null;
    if (groups.length === 1) return groups[0];
    const merged = { agents: [], allow: [], disallow: [] };
    for (const g of groups) {
      merged.agents.push(...(g.agents || []));
      merged.allow.push(...(g.allow || []));
      merged.disallow.push(...(g.disallow || []));
    }
    return merged;
  };
  const specific = robots.groups.filter(
    (g) => g && Array.isArray(g.agents) && g.agents.some((a) => lower(a) === want),
  );
  if (specific.length) return merge(specific);
  if (want === '*') return null;
  const star = robots.groups.filter(
    (g) => g && Array.isArray(g.agents) && g.agents.some((a) => a === '*'),
  );
  return merge(star);
}

// Compile a robots path pattern (`*` wildcard, trailing `$` anchor) to a RegExp.
function patternToRegExp(pattern) {
  let p = pattern;
  let anchored = false;
  if (p.endsWith('$')) {
    anchored = true;
    p = p.slice(0, -1);
  }
  const src = p
    .split('*')
    .map((seg) => seg.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + src + (anchored ? '$' : ''));
}

function matchLength(pattern, path) {
  if (!isStr(pattern) || !pattern) return -1;
  try {
    return patternToRegExp(pattern).test(path) ? pattern.length : -1;
  } catch {
    return -1;
  }
}

/**
 * RFC 9309 longest-match: the most specific matching rule wins; Allow wins
 * ties; no matching rule (or no governing group) → allowed.
 */
export function isAllowed(robots, path, token = AGENT_TOKEN) {
  const group = selectGroup(robots, token);
  if (!group) return true;
  const p = isStr(path) && path ? path : '/';
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const rule of group.allow || []) bestAllow = Math.max(bestAllow, matchLength(rule, p));
  for (const rule of group.disallow || []) bestDisallow = Math.max(bestDisallow, matchLength(rule, p));
  if (bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}

const ALLOW_ALL_ROBOTS = Object.freeze({ groups: [], sitemaps: [], content_signal: null });
const DISALLOW_ALL_ROBOTS = Object.freeze({
  groups: [{ agents: ['*'], allow: [], disallow: ['/'] }],
  sitemaps: [],
  content_signal: null,
});

/**
 * Turn a robots.txt fetch outcome into a posture record.
 *   2xx            → policy 'parsed'
 *   4xx            → 'allow_all' (RFC 9309 §2.3.1.3: unavailable = may crawl)
 *   5xx/3xx/error  → 'disallow_all' (conservative: unreachable = do not crawl)
 * `parsed` is always a robots object usable with isAllowed().
 */
export function analyzeRobots(input) {
  const status = input && Number.isFinite(input.status) ? input.status : null;
  const error = input && input.error ? String(input.error) : null;
  const text = input && isStr(input.text) ? input.text : '';

  let policy;
  let parsed;
  let present = false;
  if (!error && status !== null && status >= 200 && status < 300) {
    policy = 'parsed';
    parsed = parseRobots(text);
    present = true;
  } else if (!error && status !== null && status >= 400 && status < 500) {
    policy = 'allow_all';
    parsed = ALLOW_ALL_ROBOTS;
  } else {
    policy = 'disallow_all';
    parsed = DISALLOW_ALL_ROBOTS;
  }

  const agentsNamed = new Set();
  for (const g of parsed.groups) for (const a of g.agents || []) agentsNamed.add(lower(a));

  const aiNamed = policy === 'parsed' ? AI_BOT_NAMES.filter((n) => agentsNamed.has(lower(n))) : [];
  const aiDisallowedAll = aiNamed.filter((n) => !isAllowed(parsed, '/', n));
  const disallowsAllBots = policy === 'parsed' ? !isAllowed(parsed, '/', '*') : policy === 'disallow_all';

  return {
    present,
    status,
    policy,
    groups_count: parsed.groups.length,
    sitemap_count: parsed.sitemaps.length,
    content_signal: parsed.content_signal,
    ai_bots_named: aiNamed,
    ai_bots_disallowed_all: aiDisallowedAll,
    disallows_all_bots: disallowsAllBots,
    disallows_us: !isAllowed(parsed, '/', AGENT_TOKEN),
    mentions_claudeatlasbot: agentsNamed.has(lower(AGENT_TOKEN)),
    parsed,
  };
}

// ---------------------------------------------------------------------------
// Response classification
// ---------------------------------------------------------------------------

/**
 * 'allowed' | 'blocked' | 'challenged' | 'toll' | 'error'
 *   error/timeout/network      → 'error'
 *   402                        → 'toll'
 *   cf-mitigated: challenge, or 403/503 with a challenge body → 'challenged'
 *   401/403/451/429            → 'blocked'
 *   2xx                        → 'allowed'
 *   3xx (budget exhausted), other 5xx, anything else → 'error'
 */
export function classifyResponse(input) {
  if (!input || input.error) return 'error';
  const status = Number.isFinite(input.status) ? input.status : null;
  if (status === null) return 'error';
  const headers = input.headers || {};
  const body = isStr(input.bodySnippet) ? input.bodySnippet : '';

  if (status === 402) return 'toll';
  if (lower(hdr(headers, 'cf-mitigated')) === 'challenge') return 'challenged';
  if ((status === 403 || status === 503) && CHALLENGE_BODY_RE.test(body)) return 'challenged';
  if (status === 401 || status === 403 || status === 451 || status === 429) return 'blocked';
  if (status >= 200 && status < 300) return 'allowed';
  return 'error';
}

/**
 * Flatten a fetch outcome into the persisted summary shape. NO body text is
 * carried through — only status, headers of interest, byte counts, redirects.
 */
export function summarizeResponse(input) {
  const r = input || {};
  const headers = r.headers && typeof r.headers === 'object' ? r.headers : {};
  let finalHost = null;
  if (isStr(r.finalUrl)) {
    try {
      finalHost = new URL(r.finalUrl).host || null;
    } catch {
      finalHost = null;
    }
  }
  return {
    result: classifyResponse(r),
    status: Number.isFinite(r.status) ? r.status : null,
    server: hdr(headers, 'server'),
    cf_ray: hdr(headers, 'cf-ray') !== null,
    x_robots_tag: hdr(headers, 'x-robots-tag'),
    content_signal: hdr(headers, 'content-signal'),
    content_type: hdr(headers, 'content-type'),
    bytes: Number.isFinite(r.bytes) ? r.bytes : null,
    bytes_truncated: r.bytesTruncated === true,
    redirect_count: Number.isFinite(r.redirectCount) ? r.redirectCount : 0,
    final_url: isStr(r.finalUrl) ? r.finalUrl : null,
    final_host: finalHost,
    error: r.error ? String(r.error) : null,
  };
}

// ---------------------------------------------------------------------------
// HTML / body analysis
// ---------------------------------------------------------------------------

const JSONLD_SCRIPT_RE = /<script\b[^>]*\btype\s*=\s*["']?application\/ld\+json["']?[^>]*>/gi;

/** Count JSON-LD blocks and detect any schema.org reference. */
export function analyzeHtml(html) {
  if (!isStr(html) || !html) return { jsonld_count: 0, has_schema_org: false };
  const matches = html.match(JSONLD_SCRIPT_RE);
  return {
    jsonld_count: matches ? matches.length : 0,
    has_schema_org: /schema\.org/i.test(html),
  };
}

/**
 * One weak cloaking signal: agent-UA vs browser-UA homepage. Differs when the
 * status differs or the byte sizes differ by more than 30% (relative to the
 * smaller of the two). Any side missing,
 * errored, or without a byte count → { differs: false, reason: 'insufficient' }.
 */
export function cloakingDiff(agent, browser) {
  const insufficient = { differs: false, status_differs: false, size_ratio: null, reason: 'insufficient' };
  if (!agent || !browser) return insufficient;
  if (agent.result === 'error' || browser.result === 'error') return insufficient;
  if (agent.result === 'robots_disallowed' || browser.result === 'robots_disallowed') return insufficient;
  if (!Number.isFinite(agent.bytes) || !Number.isFinite(browser.bytes)) return insufficient;
  if (!Number.isFinite(agent.status) || !Number.isFinite(browser.status)) return insufficient;

  const statusDiffers = agent.status !== browser.status;
  const sizeRatio = round3(agent.bytes / Math.max(browser.bytes, 1));
  // Symmetric relative difference (denominator = the smaller side) so the
  // verdict does not depend on which UA got the bigger page: 100k vs 140k is
  // a 40% gap either way.
  const sizeDiffers =
    Math.abs(agent.bytes - browser.bytes) / Math.max(Math.min(agent.bytes, browser.bytes), 1) >
    CLOAKING_SIZE_THRESHOLD;
  return {
    differs: statusDiffers || sizeDiffers,
    status_differs: statusDiffers,
    size_ratio: sizeRatio,
    reason: statusDiffers ? 'status' : sizeDiffers ? 'size' : null,
  };
}

/**
 * Is a 200 for a well-known path plausibly the real thing (vs an HTML
 * catch-all / SPA shell)?
 *   'json' → the snippet parses as a JSON object/array, or the content-type says
 *            json and the snippet isn't HTML (snippet may be truncated)
 *   'text' → non-empty and not HTML
 */
export function checkWellKnownBody(expect, contentType, bodySnippet) {
  const body = isStr(bodySnippet) ? bodySnippet : '';
  const ct = lower(contentType);
  if (looksHtml(body)) return false;
  if (expect === 'json') {
    try {
      const parsed = JSON.parse(body.trim());
      return parsed !== null && typeof parsed === 'object';
    } catch {
      return /json/.test(ct) && body.trim().length > 0;
    }
  }
  if (expect === 'text') {
    if (/text\/html/.test(ct)) return false;
    return body.trim().length > 0;
  }
  return false;
}

/** Did the server honour `Accept: text/markdown`? */
export function isMarkdownNegotiated(contentType) {
  return isStr(contentType) && /^\s*text\/markdown/i.test(contentType);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function resultOf(t) {
  const r = t && t.homepage && t.homepage.result;
  return RESULT_KEYS.includes(r) ? r : 'error';
}

function wkOk(t, path) {
  const w = t && t.well_known && t.well_known[path];
  return !!(w && w.result === 'allowed' && w.plausible === true);
}

function emptyCounts() {
  const c = {};
  for (const k of RESULT_KEYS) c[k] = 0;
  return c;
}

/**
 * Roll the per-target records up into the headline numbers. The homepage
 * (agent UA) result is THE per-target result. `non_error_count` excludes
 * 'error' AND 'robots_disallowed' and is the denominator for every rate.
 */
export function aggregate(targets) {
  const list = Array.isArray(targets) ? targets.filter(Boolean) : [];
  const byResult = emptyCounts();
  const byTier = {};
  let tollCount = 0;
  let mdCount = 0;
  let cloakCount = 0;
  let jsonldCount = 0;
  let signersCount = 0;
  const robots = {
    present_count: 0,
    names_ai_bots_count: 0,
    disallows_all_bots_count: 0,
    disallows_us_count: 0,
    content_signal_count: 0,
    has_sitemap_count: 0,
  };
  const standardsOk = {};
  for (const { path } of WELL_KNOWN_PATHS) standardsOk[path] = 0;
  const sizes = [];

  for (const t of list) {
    const res = resultOf(t);
    byResult[res] += 1;

    const tier = isStr(t.tier) && t.tier ? t.tier : 'unknown';
    if (!byTier[tier]) byTier[tier] = { n: 0, ...emptyCounts(), markdown_negotiated: 0 };
    byTier[tier].n += 1;
    byTier[tier][res] += 1;

    const md = !!(t.markdown && t.markdown.negotiated === true);
    if (md) {
      mdCount += 1;
      byTier[tier].markdown_negotiated += 1;
    }
    if (t.toll === true) tollCount += 1;
    if (t.cloaking && t.cloaking.differs === true) cloakCount += 1;
    if (t.homepage && Number.isFinite(t.homepage.jsonld_count) && t.homepage.jsonld_count > 0) jsonldCount += 1;
    if (t.signs_requests === true) signersCount += 1;
    if (t.homepage && Number.isFinite(t.homepage.bytes)) sizes.push(t.homepage.bytes);

    const rb = t.robots || {};
    if (rb.present === true) robots.present_count += 1;
    if (Array.isArray(rb.ai_bots_named) && rb.ai_bots_named.length > 0) robots.names_ai_bots_count += 1;
    if (rb.disallows_all_bots === true) robots.disallows_all_bots_count += 1;
    if (rb.disallows_us === true) robots.disallows_us_count += 1;
    if (isStr(rb.content_signal) && rb.content_signal) robots.content_signal_count += 1;
    if (Number.isFinite(rb.sitemap_count) && rb.sitemap_count > 0) robots.has_sitemap_count += 1;

    for (const { path } of WELL_KNOWN_PATHS) if (wkOk(t, path)) standardsOk[path] += 1;
  }

  const total = list.length;
  const nonError = total - byResult.error - byResult.robots_disallowed;

  const standards = {};
  for (const { path } of WELL_KNOWN_PATHS) {
    standards[path] = { ok_count: standardsOk[path], rate: rate(standardsOk[path], nonError) };
  }

  sizes.sort((a, b) => a - b);
  const sizeBytes = sizes.length
    ? {
        min: sizes[0],
        median: sizes.length % 2 ? sizes[(sizes.length - 1) / 2] : Math.round((sizes[sizes.length / 2 - 1] + sizes[sizes.length / 2]) / 2),
        max: sizes[sizes.length - 1],
      }
    : { min: null, median: null, max: null };

  const controlTarget = list.find((t) => t.domain === 'claudeatlas.com') || null;
  const control = controlTarget
    ? {
        domain: 'claudeatlas.com',
        allowed: resultOf(controlTarget) === 'allowed',
        markdown_negotiated: !!(controlTarget.markdown && controlTarget.markdown.negotiated === true),
        llms_txt_ok: wkOk(controlTarget, '/llms.txt'),
      }
    : null;

  const requestsTotal = list.reduce((n, t) => n + (Number.isFinite(t && t.requests_made) ? t.requests_made : 0), 0);
  const targetTimeMs = list.reduce((n, t) => n + (Number.isFinite(t && t.duration_ms) ? t.duration_ms : 0), 0);

  return {
    targets_total: total,
    by_result: byResult,
    non_error_count: nonError,
    requests_total: requestsTotal,
    target_time_ms_sum: targetTimeMs,
    block_rate: rate(byResult.blocked + byResult.challenged, nonError),
    allowed_rate: rate(byResult.allowed, nonError),
    challenged_count: byResult.challenged,
    toll_count: tollCount,
    markdown_negotiation_rate: rate(mdCount, nonError),
    cloaking_count: cloakCount,
    jsonld_present_count: jsonldCount,
    signers_count: signersCount,
    standards,
    robots,
    size_bytes: sizeBytes,
    by_tier: byTier,
    control,
    control_passes: !!(control && control.allowed && control.markdown_negotiated && control.llms_txt_ok),
  };
}

// ---------------------------------------------------------------------------
// Markdown report
// ---------------------------------------------------------------------------

function pct(x) {
  return Number.isFinite(x) ? (x * 100).toFixed(1) + '%' : '—';
}

function yn(v) {
  return v === true ? 'yes' : v === false ? 'no' : '—';
}

function cell(v) {
  if (v === null || v === undefined) return '—';
  return String(v).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const sec = Math.round(ms / 1000);
  if (sec < 60) return sec + 's';
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem ? min + 'm ' + rem + 's' : min + 'm';
}

function fmtBytes(b) {
  if (!Number.isFinite(b)) return '—';
  if (b >= 1024 * 1024) return (b / (1024 * 1024)).toFixed(1) + ' MB';
  if (b >= 1024) return Math.round(b / 1024) + ' KB';
  return b + ' B';
}

// ✓ = 200 + plausible body; — = never fetched (robots-disallowed) or no HTTP
// answer at all (network error, status null); ✗ = the site answered with
// anything else (404 / 403 / HTML shell / …).
function matrixMark(t, path) {
  const w = t && t.well_known && t.well_known[path];
  if (!w) return '—';
  if (w.result === 'robots_disallowed') return '—';
  if (w.result === 'error' && !Number.isFinite(w.status)) return '—';
  return w.result === 'allowed' && w.plausible === true ? '✓' : '✗';
}

/** GitHub-flavoured markdown report for a full pass object. */
export function renderReport(pass) {
  const p = pass && typeof pass === 'object' ? pass : {};
  const targets = Array.isArray(p.targets) ? p.targets.filter(Boolean) : [];
  const agg = p.aggregate && typeof p.aggregate === 'object' ? p.aggregate : aggregate(targets);
  const runAt = isStr(p.run_at) ? p.run_at : 'unknown';
  const agent = p.agent || {};
  const ua = isStr(agent.ua) ? agent.ua : AGENT_UA;
  const policy = agent.policy && typeof agent.policy === 'object' ? agent.policy : POLICY;
  const probePaths = Array.isArray(agent.probe_paths) ? agent.probe_paths : WELL_KNOWN_PATHS.map((w) => w.path);
  const byResult = agg.by_result || emptyCounts();
  const lines = [];

  lines.push(`# Reciprocal Pass v1 — how the web treats a declared bot`);
  lines.push('');
  // Older datasets predate requests_total / target_time_ms_sum in the stored
  // aggregate — fall back to summing the per-target fields so re-renders work.
  const sumField = (k) => targets.reduce((n, t) => n + (Number.isFinite(t && t[k]) ? t[k] : 0), 0);
  const requestsTotal = Number.isFinite(agg.requests_total) ? agg.requests_total : sumField('requests_made');
  const targetTimeSum = Number.isFinite(agg.target_time_ms_sum) ? agg.target_time_ms_sum : sumField('duration_ms');
  const finishedAt = isStr(p.finished_at) ? p.finished_at : null;
  const durationMs = Number.isFinite(p.duration_ms) ? p.duration_ms : null;
  lines.push(`Run: \`${runAt}\` · Agent: \`${ua}\``);
  lines.push('');
  lines.push(
    'Finished: `' + (finishedAt ?? 'unknown') + '` · Wall-clock: **' + (durationMs == null ? 'unknown' : fmtDuration(durationMs)) + '** · Requests: **' + requestsTotal + '** · ' +
      'Sum of per-target time: ' + fmtDuration(targetTimeSum) + ' (' + (p.agent && p.agent.policy ? p.agent.policy.concurrency : '?') + ' hosts in flight)',
  );
  lines.push('');
  lines.push(
    'One polite, read-only, meta-only pass by a self-declared bot (a fixed-probe crawler, no model in the loop) over the operators whose bots appear in the ClaudeAtlas request log. Servers see the declaration, not what sits behind it, so this is the treatment any declared automated client — agent or crawler — receives. Getting blocked is data, not failure. Details of the bot and how to block it: https://claudeatlas.com/bot/',
  );
  lines.push('');

  lines.push('## Headline');
  lines.push('');
  lines.push(`- Targets probed: **${agg.targets_total ?? 0}** (${agg.non_error_count ?? 0} answered; ${byResult.error} error, ${byResult.robots_disallowed} robots-disallowed)`);
  lines.push(`- Block rate (blocked + challenged, of those that answered): **${pct(agg.block_rate)}**`);
  lines.push(`- Allowed rate: **${pct(agg.allowed_rate)}** (${byResult.allowed} allowed · ${byResult.blocked} blocked · ${byResult.challenged} challenged)`);
  lines.push(`- Challenge pages (Cloudflare / Akamai / captcha): ${agg.challenged_count ?? 0}`);
  lines.push(`- Toll (HTTP 402 anywhere on the target): ${agg.toll_count ?? 0}`);
  lines.push(`- Markdown negotiation (\`Accept: text/markdown\` honoured): **${pct(agg.markdown_negotiation_rate)}**`);
  lines.push(`- Publish a Web Bot Auth key directory (they sign their own requests): ${agg.signers_count ?? 0}`);
  lines.push(`- JSON-LD on the homepage: ${agg.jsonld_present_count ?? 0}`);
  lines.push(`- Cloaking incidence (agent vs browser UA differs by status or >30% size): ${agg.cloaking_count ?? 0}`);
  const sb = agg.size_bytes || {};
  lines.push(`- Homepage size to an agent: min ${fmtBytes(sb.min)} · median ${fmtBytes(sb.median)} · max ${fmtBytes(sb.max)}`);
  lines.push(`- control_passes (claudeatlas.com passes its own probe): **${yn(agg.control_passes)}**`);
  lines.push('');

  lines.push('## By tier');
  lines.push('');
  lines.push('| tier | n | allowed | blocked | challenged | toll | error | robots_disallowed | md-neg |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [tier, c] of Object.entries(agg.by_tier || {})) {
    lines.push(`| ${cell(tier)} | ${c.n} | ${c.allowed} | ${c.blocked} | ${c.challenged} | ${c.toll} | ${c.error} | ${c.robots_disallowed} | ${c.markdown_negotiated} |`);
  }
  lines.push('');

  lines.push('## Per target');
  lines.push('');
  lines.push('| domain | tier | result | status | server | md-neg | llms.txt | signs | cloak | bytes |');
  lines.push('| --- | --- | --- | ---: | --- | --- | --- | --- | --- | ---: |');
  for (const t of targets) {
    const h = t.homepage || {};
    lines.push(
      `| ${cell(t.domain)} | ${cell(t.tier)} | ${cell(resultOf(t))} | ${cell(h.status)} | ${cell(h.server)} | ${yn(!!(t.markdown && t.markdown.negotiated))} | ${matrixMark(t, '/llms.txt')} | ${yn(t.signs_requests === true)} | ${t.cloaking && t.cloaking.differs ? 'yes (' + t.cloaking.reason + ')' : t.cloaking && t.cloaking.reason === 'insufficient' ? '—' : 'no'} | ${fmtBytes(h.bytes)} |`,
    );
  }
  lines.push('');

  lines.push('## Agent-web standards matrix');
  lines.push('');
  lines.push('✓ = 200 with a plausible body · ✗ = the site answered with anything else (404, 403, HTML shell…) · — = not fetched (robots-disallowed) or no HTTP answer (network error)');
  lines.push('');
  lines.push(`| domain | ${probePaths.map((x) => `\`${x}\``).join(' | ')} |`);
  lines.push(`| --- | ${probePaths.map(() => ':-:').join(' | ')} |`);
  for (const t of targets) {
    lines.push(`| ${cell(t.domain)} | ${probePaths.map((path) => matrixMark(t, path)).join(' | ')} |`);
  }
  const std = agg.standards || {};
  lines.push(`| **adoption** | ${probePaths.map((path) => (std[path] ? `${std[path].ok_count} (${pct(std[path].rate)})` : '—')).join(' | ')} |`);
  lines.push('');

  lines.push('## robots.txt posture');
  lines.push('');
  lines.push('| domain | present | policy | names AI bots | disallows all bots | disallows us | content-signal | sitemap |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const t of targets) {
    const r = t.robots || {};
    const named = Array.isArray(r.ai_bots_named) && r.ai_bots_named.length ? r.ai_bots_named.length + ' (' + (Array.isArray(r.ai_bots_disallowed_all) ? r.ai_bots_disallowed_all.length : 0) + ' disallowed)' : 'no';
    lines.push(`| ${cell(t.domain)} | ${yn(r.present)} | ${cell(r.policy)} | ${named} | ${yn(r.disallows_all_bots)} | ${yn(r.disallows_us)} | ${r.content_signal ? '`' + cell(r.content_signal) + '`' : 'no'} | ${yn(Number.isFinite(r.sitemap_count) ? r.sitemap_count > 0 : null)} |`);
  }
  const rb = agg.robots || {};
  lines.push(`| **totals** | ${rb.present_count ?? 0} | | ${rb.names_ai_bots_count ?? 0} | ${rb.disallows_all_bots_count ?? 0} | ${rb.disallows_us_count ?? 0} | ${rb.content_signal_count ?? 0} | ${rb.has_sitemap_count ?? 0} |`);
  lines.push('');

  lines.push('## Method');
  lines.push('');
  lines.push(
    `User-Agent \`${ua}\`. Per target: \`GET /robots.txt\` first, then — only if robots.txt allows us — \`GET /\` three times (agent UA with an HTML Accept, agent UA with \`Accept: text/markdown, text/html;q=0.9\`, and a standard browser UA for the single cloaking comparison), then each of ${probePaths.length} fixed well-known paths (${probePaths.map((x) => `\`${x}\``).join(', ')}), each individually gated by robots.txt. ` +
      `Policy: ${policy.method || 'GET'} only; ≥${policy.min_host_spacing_ms} ms between consecutive requests to one host (redirect hops included); at most ${policy.concurrency} hosts in flight; ${policy.timeout_ms} ms timeout per hop; ≤${policy.max_redirects} redirects; ≤${Math.round(BODY_CAP_BYTES / 1024)} KB read per response; ${policy.retry_on_network_error} retry on network error only, never on any HTTP status. ` +
      `A robots.txt 4xx is treated as allow-all, a 5xx/timeout as disallow-all. Only statuses, selected headers, byte counts, robots directives, JSON-LD counts and content-types are recorded — no page text. The per-target result is the agent-UA homepage classification; rates are over targets that answered (excluding network errors and robots-disallowed). ` +
      `The block rate counts both hard blocks (401/403/429/451) and interstitial challenge pages; a 402 anywhere on the target is recorded as a toll.`,
  );
  lines.push('');
  return lines.join('\n');
}
