/**
 * worker/asn-class.js — pure ASN → network-class module
 * (quick-260812-p3b, L1 network-aware classifier).
 *
 * Turns a request's (asn, asOrganization) pair into one of three buckets —
 * 'hosting' | 'isp_residential' | 'unknown' — and answers whether a claimed
 * AI operator's traffic is arriving from a network CONSISTENT with that
 * operator's published infrastructure. Both answers feed worker/classify.js's
 * L1/L2 upgrade:
 *
 *   - a known-agent/crawler UA from a HOSTING ASN that does NOT match the
 *     claimed operator's network → impersonation_suspected.
 *   - a coherent browser UA from a HOSTING ASN → automated_unknown
 *     (never 'human').
 *
 * HEURISTIC BY DESIGN: everything here is static substring/ASN matching with
 * ZERO imports and ZERO I/O, so it unit-tests under plain `node --test` and
 * runs inside the ctx.waitUntil logging path without touching the network.
 * The ASN number set is a best-effort seed; the asOrganization keyword lists
 * are the primary signal. CIDR IP-range verification against the vendors'
 * published range JSONs (openai.com/chatgpt-user.json,
 * claude.com/crawling/bots.json, perplexity.com/perplexity-user.json,
 * developers.google.com/…/user-triggered-agents.json — see
 * docs/agent-analytics-research/03-identification-standards.md §3) is a
 * DOCUMENTED FOLLOW-UP, intentionally NOT built in v1.
 */

// ---------------------------------------------------------------------------
// Known hosting/datacenter ASNs. Seeded from classify.js DATACENTER_ASNS plus
// the networks the 2026-08-12 production evidence surfaced (Kingsoft, Huawei
// Cloud, Alibaba/Tencent variants, Cloudflare, …). Best-effort seed — the
// HOSTING_ORG_RE keyword list below is the primary signal.
// ---------------------------------------------------------------------------
export const HOSTING_ASNS = new Set([
  16509, // AWS
  14618, // AWS
  8075, // Microsoft Azure
  396982, // Google Cloud Platform
  16276, // OVH
  24940, // Hetzner
  14061, // DigitalOcean
  63949, // Linode / Akamai
  20473, // Vultr
  45102, // Alibaba Cloud
  37963, // Alibaba Cloud (Aliyun)
  132203, // Tencent Cloud
  45090, // Tencent / Shenzhen (also seen for Kingsoft-adjacent)
  31898, // Oracle Cloud
  55990, // Huawei Cloud
  136907, // Huawei Cloud (HWCLOUDS)
  13335, // Cloudflare
]);

// asOrganization keywords indicating a hosting/datacenter network. Matched
// case-insensitively as substrings.
//
// CRITICAL: bare `google` is deliberately ABSENT — Googlebot and Google Cloud
// share Google network space, and plain 'GOOGLE' (Googlebot's org) must stay
// non-hosting so the human/crawler paths survive. Only `google cloud` / `gcp`
// key hosting.
// Matched as case-insensitive SUBSTRINGS (no word boundaries) so run-together
// orgs like CLOUDFLARENET / AMAZON-02 / GOOGLE-CLOUD-PLATFORM still key.
const HOSTING_ORG_RE =
  /aws|amazon|ec2|azure|microsoft|google[\s_-]?cloud|gcp|alibaba|aliyun|tencent|kingsoft|huawei|ovh|hetzner|digital[\s_-]?ocean|vultr|linode|akamai|cloudflare|oracle|scaleway|leaseweb|contabo|m247|choopa|seedbox|hosting|datacenter|data[\s_-]?center|colo|vps|dedicated|server/i;

// asOrganization keywords indicating a residential/consumer ISP network.
const RESIDENTIAL_ORG_RE =
  /comcast|verizon|at&t|at\s?t|t-mobile|charter|spectrum|cox|centurylink|china[\s_-]?mobile|china[\s_-]?telecom|china[\s_-]?unicom|vodafone|orange|deutsche[\s_-]?telekom|telus|rogers|broadband|residential|telecom|communications|cable|dsl|fiber|fios/i;

/**
 * classifyAsn(asn, asOrg) → 'hosting' | 'isp_residential' | 'unknown'.
 *
 * Hosting is checked FIRST (a datacenter ASN or hosting-keyword org wins),
 * then residential, else 'unknown'. Never throws — non-string/non-number
 * inputs are treated as absent.
 */
export function classifyAsn(asn, asOrg) {
  if (typeof asn === 'number' && Number.isFinite(asn) && HOSTING_ASNS.has(asn)) {
    return 'hosting';
  }
  const org = typeof asOrg === 'string' ? asOrg : '';
  if (org) {
    if (HOSTING_ORG_RE.test(org)) return 'hosting';
    if (RESIDENTIAL_ORG_RE.test(org)) return 'isp_residential';
  }
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Operator → published-network hint. ONLY AI operators appear here; SEO/other
// operators are intentionally absent so matchesOperatorNetwork returns null
// ("no opinion") for them and they are NEVER flagged as impersonation.
//
// Published vendor networks (docs/agent-analytics-research/
// 03-identification-standards.md §3): OpenAI on Microsoft/Azure; Anthropic on
// Google/AWS; Perplexity on AWS; Google on Google; Mistral on OVH/Scaleway/
// Azure. Regexes are permissive supersets of each operator's known homes.
// ---------------------------------------------------------------------------
export const OPERATOR_NETWORK_HINTS = {
  openai: /microsoft|azure|openai/i,
  anthropic: /google|amazon|aws|anthropic/i,
  'anthropic-claude-code': /google|amazon|aws|anthropic/i,
  perplexity: /perplexity|amazon|aws/i,
  mistral: /mistral|ovh|scaleway|azure|microsoft/i,
  google: /google/i,
  bytedance: /bytedance|byteplus/i,
  meta: /meta|facebook/i,
  amazon: /amazon|aws/i,
  apple: /apple/i,
  microsoft: /microsoft|azure/i,
  huawei: /huawei/i,
};

/**
 * matchesOperatorNetwork(operator, asn, asOrg) → true | false | null.
 *
 *   null  — no hint for this operator (SEO tools, unknown operators): no
 *           opinion, so the caller never flags impersonation.
 *   true  — asOrg matches the operator's published-network regex.
 *   false — a hint exists but asOrg does not match it (the impersonation
 *           signal, when combined with a hosting ASN).
 *
 * `asn` is accepted for signature symmetry / future CIDR work; v1 matches on
 * asOrganization only.
 */
export function matchesOperatorNetwork(operator, asn, asOrg) {
  const key = typeof operator === 'string' ? operator : '';
  const hint = OPERATOR_NETWORK_HINTS[key];
  if (!hint) return null; // no opinion
  if (typeof asOrg === 'string' && hint.test(asOrg)) return true;
  return false;
}
