/**
 * worker/classify.js — traffic classifier v0 (quick-260806-dn3, experiment E1).
 *
 * Classifies a single request into one of five classes:
 *
 *   human             — browser-shaped UA + coherent Sec-Fetch headers + a
 *                       non-datacenter ASN. The ONLY path to 'human'.
 *   agent             — user/task-triggered AI agents (ChatGPT-User,
 *                       Claude-User, claude-code, ...). The traffic the
 *                       product thesis cares about.
 *   crawler           — bulk fetchers: AI-training crawlers (GPTBot,
 *                       ClaudeBot, Bytespider, ...) + SEO/search crawlers.
 *   automated_unknown — clearly automated but unidentified: scripting
 *                       library UAs, empty UAs, browser UAs from
 *                       datacenter ASNs, incoherent Sec-Fetch signatures.
 *   unknown           — genuinely ambiguous. NEVER silently coerced to
 *                       'human' — binary human/bot classifiers mislabel
 *                       30-39% of traffic exactly because they default
 *                       ambiguity to human (research §TL;DR-7 in
 *                       docs/agent-traffic-analytics-research.md).
 *
 * Pure ESM module: zero imports, zero I/O, takes a plain signals object
 * (never a Request) so it unit-tests under plain `node --test`. Called from
 * worker/request-log.js inside ctx.waitUntil — NEVER in the response path.
 *
 * Input signals (all nullable):
 *   { userAgent, asn, asOrg, accept, secFetchMode, secFetchSite,
 *     secFetchDest, secChUa, signatureAgent }
 *
 * Output verdict:
 *   { class, operator, confidence, method }
 *   method ∈ ua_list | no_ua | asn_heuristic | coherence | default
 */

// ---------------------------------------------------------------------------
// UA pattern tables. Matching is case-insensitive substring (or prefix where
// noted). ORDER MATTERS: agents are checked before crawlers so 'Claude-User'
// can never be swallowed by a broader Claude crawler pattern, and within the
// crawler list 'Claude-SearchBot' precedes 'ClaudeBot'.
// ---------------------------------------------------------------------------

// User/task-triggered AI agents — a human asked a question and the agent
// fetched us to answer it. Distinct from crawlers (bulk ingestion).
export const AGENT_UA_PATTERNS = [
  { pattern: 'chatgpt-user', operator: 'openai' },
  { pattern: 'claude-user', operator: 'anthropic' },
  { pattern: 'perplexity-user', operator: 'perplexity' },
  { pattern: 'mistralai-user', operator: 'mistral' },
  // claude-code sends `claude-code/<version>` as a UA PREFIX.
  { pattern: 'claude-code/', operator: 'anthropic-claude-code', prefix: true },
];

// Bulk crawlers: AI-training + AI-search + SEO/search-engine fetchers.
export const CRAWLER_UA_PATTERNS = [
  { pattern: 'gptbot', operator: 'openai' },
  { pattern: 'oai-searchbot', operator: 'openai' },
  // Claude-SearchBot BEFORE ClaudeBot: both contain 'claude'; keep the more
  // specific token first so ordering (not luck) decides.
  { pattern: 'claude-searchbot', operator: 'anthropic' },
  { pattern: 'claudebot', operator: 'anthropic' },
  { pattern: 'perplexitybot', operator: 'perplexity' },
  { pattern: 'bytespider', operator: 'bytedance' },
  { pattern: 'meta-externalagent', operator: 'meta' },
  { pattern: 'amazonbot', operator: 'amazon' },
  // Applebot-Extended matches the 'applebot' substring too — one entry.
  { pattern: 'applebot', operator: 'apple' },
  { pattern: 'googlebot', operator: 'google' },
  { pattern: 'google-extended', operator: 'google' },
  { pattern: 'googleother', operator: 'google' },
  { pattern: 'bingbot', operator: 'microsoft' },
  { pattern: 'dataforseobot', operator: 'dataforseo' },
  { pattern: 'semrushbot', operator: 'semrush' },
  { pattern: 'ahrefsbot', operator: 'ahrefs' },
  { pattern: 'petalbot', operator: 'huawei' },
];

// Generic scripting/automation UAs — automated for sure, operator unknown.
export const AUTOMATION_UA_PATTERNS = [
  'python-requests',
  'python-httpx',
  'aiohttp',
  'axios',
  'node-fetch',
  'undici',
  'go-http-client',
  'okhttp',
  'scrapy',
  'curl',
  'wget',
  'headlesschrome',
];

// Known cloud/datacenter ASNs. A browser-shaped UA originating from one of
// these is near-certainly automation (Browser Use / headless farms).
// NOTE Google Cloud is deliberately NOT keyed by ASN here — Googlebot and
// Google Cloud share Google network space; we match asOrg /google cloud/i
// instead so plain 'GOOGLE' (Googlebot's org) never trips the heuristic.
export const DATACENTER_ASNS = new Set([
  16509, // AWS
  14618, // AWS
  8075, // Microsoft Azure
  16276, // OVH
  24940, // Hetzner
  14061, // DigitalOcean
  63949, // Linode / Akamai
  20473, // Vultr
  45102, // Alibaba Cloud
  132203, // Tencent Cloud
  31898, // Oracle Cloud
]);

// asOrg keywords that indicate hosting/datacenter networks. Matched only for
// browser-shaped UAs (crawlers already caught by the UA lists above).
const DATACENTER_ORG_RE = /hosting|datacenter|data center|colo|server/i;
const GOOGLE_CLOUD_ORG_RE = /google[\s_-]?cloud/i;

// ---------------------------------------------------------------------------
// Sec-Fetch coherence (research §3 L2 — the Browser Use signature).
//
// Every Chromium ≥80 (and modern Firefox/Safari) sends Sec-Fetch-Mode /
// -Site / -Dest on navigations. A UA CLAIMING modern Chromium while sending
// none of them is contradicting itself — the classic headless-automation
// fingerprint.
//
// Returns: 1 = coherent (headers present) / 0 = contradiction / null = n/a
// (UA doesn't claim a version we can hold to the expectation).
// ---------------------------------------------------------------------------
export function computeSecFetchCoherence(signals = {}) {
  const { userAgent, secFetchMode, secFetchSite, secFetchDest } = signals || {};
  const hasSecFetch = Boolean(secFetchMode || secFetchSite || secFetchDest);
  if (hasSecFetch) return 1;
  const ua = typeof userAgent === 'string' ? userAgent : '';
  const chromeMatch = ua.match(/chrome\/(\d+)/i);
  if (chromeMatch && parseInt(chromeMatch[1], 10) >= 80) return 0;
  return null;
}

function isDatacenter(asn, asOrg) {
  if (typeof asn === 'number' && DATACENTER_ASNS.has(asn)) return true;
  if (typeof asOrg === 'string' && asOrg) {
    if (GOOGLE_CLOUD_ORG_RE.test(asOrg)) return true;
    if (DATACENTER_ORG_RE.test(asOrg)) return true;
  }
  return false;
}

function verdict(cls, operator, confidence, method) {
  return { class: cls, operator, confidence, method };
}

// ---------------------------------------------------------------------------
// classifyRequest(signals) → { class, operator, confidence, method }
//
// Decision order (first match wins):
//   1. agent UA list          → agent, 0.9
//   2. crawler UA list        → crawler, 0.9
//   3. automation UA list     → automated_unknown, 0.8
//   4. empty/missing UA       → automated_unknown, 0.7 (no_ua)
//   5. browser-shaped UA      → datacenter ASN / Sec-Fetch coherence
//   6. anything else          → unknown, 0.3 — NEVER human by default
// ---------------------------------------------------------------------------
export function classifyRequest(signals = {}) {
  const s = signals || {};
  const rawUa = typeof s.userAgent === 'string' ? s.userAgent : '';
  const ua = rawUa.toLowerCase();

  // 1. User/task-triggered agents. Checked FIRST (Claude-User before any
  //    crawler token could shadow it).
  for (const entry of AGENT_UA_PATTERNS) {
    const hit = entry.prefix ? ua.startsWith(entry.pattern) : ua.includes(entry.pattern);
    if (hit) return verdict('agent', entry.operator, 0.9, 'ua_list');
  }

  // 2. Crawlers.
  for (const entry of CRAWLER_UA_PATTERNS) {
    if (ua.includes(entry.pattern)) {
      return verdict('crawler', entry.operator, 0.9, 'ua_list');
    }
  }

  // 3. Generic automation libraries.
  for (const pattern of AUTOMATION_UA_PATTERNS) {
    if (ua.includes(pattern)) {
      return verdict('automated_unknown', null, 0.8, 'ua_list');
    }
  }

  // 4. No UA at all — real browsers always send one.
  if (!ua.trim()) {
    return verdict('automated_unknown', null, 0.7, 'no_ua');
  }

  // 5. Browser-shaped UA: coherence + ASN.
  if (ua.startsWith('mozilla/')) {
    const coherent = computeSecFetchCoherence(s);
    const datacenter = isDatacenter(s.asn, s.asOrg);
    if (datacenter) {
      // Browser UA claimed from cloud infrastructure — headless automation.
      return verdict('automated_unknown', null, 0.7, 'asn_heuristic');
    }
    if (coherent === 0) {
      // Claims modern Chromium but sends no Sec-Fetch headers — the
      // contradiction is the Browser Use signature.
      return verdict('automated_unknown', null, 0.6, 'coherence');
    }
    if (coherent === 1) {
      return verdict('human', null, 0.7, 'coherence');
    }
    // Coherence not applicable (old/odd browser UA): AMBIGUOUS. Never
    // default to human — that's the measured 30-39% failure mode.
    return verdict('unknown', null, 0.5, 'default');
  }

  // 6. Non-browser, unlisted UA — no idea. Ambiguity stays visible.
  return verdict('unknown', null, 0.3, 'default');
}
