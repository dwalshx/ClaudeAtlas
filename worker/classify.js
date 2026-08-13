/**
 * worker/classify.js — traffic classifier v1, L1 network-aware
 * (quick-260806-dn3 E1 baseline; quick-260812-p3b L1/L2 upgrade).
 *
 * Classifies a single request into one of these classes:
 *
 *   human                  — browser-shaped UA + coherent Sec-Fetch headers +
 *                            a non-hosting ASN. The ONLY path to 'human'.
 *   agent                  — user/task-triggered AI agents (ChatGPT-User,
 *                            Claude-User, claude-code, ...). The traffic the
 *                            product thesis cares about.
 *   crawler                — bulk fetchers: AI-training crawlers (GPTBot,
 *                            ClaudeBot, Bytespider, ...) + SEO/search crawlers.
 *   automated_unknown      — clearly automated but unidentified: scripting
 *                            library UAs, empty UAs, coherent browser UAs from
 *                            hosting/datacenter ASNs, incoherent Sec-Fetch.
 *   impersonation_suspected — a known-agent/crawler UA arriving from a HOSTING
 *                            ASN that does NOT match the claimed operator's
 *                            published network (the credential-scanner
 *                            spoofing class; quick-260812-p3b / L1).
 *   unknown                — genuinely ambiguous. NEVER silently coerced to
 *                            'human' — binary human/bot classifiers mislabel
 *                            30-39% of traffic exactly because they default
 *                            ambiguity to human (research §TL;DR-7 in
 *                            docs/agent-traffic-analytics-research.md).
 *
 * ESM module: takes a plain signals object (never a Request) so it unit-tests
 * under plain `node --test`. Its only import is the pure, I/O-free
 * worker/asn-class.js network module. Called from worker/request-log.js inside
 * ctx.waitUntil — NEVER in the response path. Adds NO network fetches; CIDR
 * IP-range verification against the vendor range JSONs (see
 * docs/agent-analytics-research/03-identification-standards.md §3) is a
 * documented follow-up, not shipped here.
 *
 * Input signals (all nullable):
 *   { userAgent, asn, asOrg, accept, secFetchMode, secFetchSite,
 *     secFetchDest, secChUa, signatureAgent, agentToken, mcpValid,
 *     mcpClient, wbaStatus }
 *   wbaStatus ∈ 'verified' | 'failed' | 'present_unverified' | 'absent'
 *     — when 'verified', cryptographic identity overrides ASN heuristics and
 *       the request is NEVER flagged impersonation_suspected.
 *
 * Output verdict:
 *   { class, operator, confidence, method }
 *   method ∈ token_echo | mcp | ua_list | ua_asn_mismatch | no_ua |
 *            coherent_datacenter | coherence | default
 */

import { classifyAsn, matchesOperatorNetwork } from './asn-class.js';

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

// Known cloud/datacenter ASNs. Retained as a seed list / back-compat export
// (worker/asn-class.js HOSTING_ASNS is a superset and the authoritative
// hosting definition since quick-260812-p3b). A browser-shaped UA from one of
// these is near-certainly automation (Browser Use / headless farms).
// NOTE Google Cloud is deliberately NOT keyed by ASN here — Googlebot and
// Google Cloud share Google network space; asn-class matches asOrg
// /google cloud/i instead so plain 'GOOGLE' (Googlebot's org) never trips.
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

function verdict(cls, operator, confidence, method) {
  return { class: cls, operator, confidence, method };
}

// ---------------------------------------------------------------------------
// L1 network check (quick-260812-p3b). Called on an agent/crawler UA hit to
// decide whether the declared operator is consistent with the NETWORK the
// request came from.
//
//   - wbaStatus 'verified' → cryptographic identity dominates; return the
//     declared verdict, NEVER flag impersonation.
//   - hosting ASN AND the operator has a published-network hint that the
//     asOrg fails (matchesOperatorNetwork === false) → impersonation_suspected.
//     (null = no hint set, e.g. SEO tools, and true = network matches both
//     fall through to the declared verdict; a non-hosting ASN also passes.)
//   - otherwise → the declared verdict unchanged.
// ---------------------------------------------------------------------------
function checkOperatorNetwork(cls, operator, confidence, s) {
  if (s.wbaStatus === 'verified') {
    return verdict(cls, operator, confidence, 'ua_list');
  }
  if (
    classifyAsn(s.asn, s.asOrg) === 'hosting' &&
    matchesOperatorNetwork(operator, s.asn, s.asOrg) === false
  ) {
    return verdict('impersonation_suspected', operator, 0.8, 'ua_asn_mismatch');
  }
  return verdict(cls, operator, confidence, 'ua_list');
}

// ---------------------------------------------------------------------------
// classifyRequest(signals) → { class, operator, confidence, method }
//
// Decision order (first match wins):
//   0. X-ClaudeAtlas-Agent token echo → agent, 0.95 (token_echo) — E3,
//      quick-260806-ejd. Checked BEFORE the UA lists: an echoed token
//      proves instruction-following regardless of the client's UA (a
//      python-requests UA echoing the token is still class=agent).
//   0.5. valid MCP POST → agent, 0.95 (mcp) — E4, quick-260806-f00. After
//      token_echo (an echoed token remains the strongest instruction-
//      following proof), before the UA lists (an MCP POST is
//      definitionally an agent regardless of UA).
//   1. agent UA list          → agent, 0.9 (L1 network check → may flag
//                               impersonation_suspected, 0.8, ua_asn_mismatch)
//   2. crawler UA list        → crawler, 0.9 (same L1 network check)
//   3. automation UA list     → automated_unknown, 0.8
//   4. empty/missing UA       → automated_unknown, 0.7 (no_ua)
//   5. browser-shaped UA      → hosting ASN (coherent_datacenter) /
//                               Sec-Fetch coherence
//   6. anything else          → unknown, 0.3 — NEVER human by default
// ---------------------------------------------------------------------------
export function classifyRequest(signals = {}) {
  const s = signals || {};
  const rawUa = typeof s.userAgent === 'string' ? s.userAgent : '';
  const ua = rawUa.toLowerCase();

  // 0. E3 token echo — Tier-1 agent signal. Optional '; tool=<name>' suffix
  //    becomes the operator (trimmed, lowercased).
  if (typeof s.agentToken === 'string' && s.agentToken.trim()) {
    let toolOperator = null;
    const toolMatch = s.agentToken.match(/;\s*tool=([^;]+)/i);
    if (toolMatch && toolMatch[1].trim()) {
      toolOperator = toolMatch[1].trim().toLowerCase();
    }
    return verdict('agent', toolOperator, 0.95, 'token_echo');
  }

  // 0.5. E4 MCP front door — a structurally valid JSON-RPC POST to /mcp is
  //      by definition an agent (no SEO tool speaks MCP; research report 6
  //      §6). signals.mcpValid is derived in request-log.js from the
  //      x-ca-mcp response marker set by worker/mcp.js; mcpClient is
  //      initialize's clientInfo (x-ca-mcp-client marker).
  if (s.mcpValid === true) {
    let op = null;
    if (typeof s.mcpClient === 'string' && s.mcpClient.trim()) {
      op = s.mcpClient.trim().toLowerCase();
    }
    return verdict('agent', op, 0.95, 'mcp');
  }

  // 1. User/task-triggered agents. Checked FIRST (Claude-User before any
  //    crawler token could shadow it). L1: a hit runs through
  //    checkOperatorNetwork — a hosting ASN mismatching the claimed operator
  //    flags impersonation_suspected (unless WBA-verified).
  for (const entry of AGENT_UA_PATTERNS) {
    const hit = entry.prefix ? ua.startsWith(entry.pattern) : ua.includes(entry.pattern);
    if (hit) return checkOperatorNetwork('agent', entry.operator, 0.9, s);
  }

  // 2. Crawlers. Same L1 network check on hit.
  for (const entry of CRAWLER_UA_PATTERNS) {
    if (ua.includes(entry.pattern)) {
      return checkOperatorNetwork('crawler', entry.operator, 0.9, s);
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

  // 5. Browser-shaped UA: coherence + ASN. L2: a coherent browser UA from a
  //    hosting/datacenter ASN (per asn-class classifyAsn) is a headless farm,
  //    never human.
  if (ua.startsWith('mozilla/')) {
    const coherent = computeSecFetchCoherence(s);
    const datacenter = classifyAsn(s.asn, s.asOrg) === 'hosting';
    if (datacenter) {
      // Browser UA claimed from cloud infrastructure — headless automation.
      return verdict('automated_unknown', null, 0.7, 'coherent_datacenter');
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
