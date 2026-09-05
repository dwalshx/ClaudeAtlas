/**
 * scripts/lib/agent-band.js — pure per-session agent-likelihood scorer
 * (quick-260905-esm).
 *
 * Given ONE per-session aggregate row of Cloudflare D1 `request_log` signals,
 * returns a probabilistic band (human-shaped / uncertain / agent-shaped) plus
 * the derived evidence features. This module is PURE:
 *   - ZERO I/O (no fs, no fetch) — importable by both scripts/agent-band.js and
 *     the unit test.
 *   - Deterministic — same input always yields the same output.
 *
 * ── SESSION DEFINITION ──────────────────────────────────────────────────────
 * A "session" is the tuple (ip_hash, user_agent) within ONE UTC calendar day.
 * The request_log `ip_hash` is DAILY-SALTED: the same real client hashes to a
 * different ip_hash each day, so sessions are per-day only and cannot be linked
 * across days. That is an accepted limitation for this measurement — the goal is
 * a daily probabilistic estimate of "agents hiding in the human bucket," not
 * cross-day identity.
 *
 * ── CALIBRATION ─────────────────────────────────────────────────────────────
 * The weights and band thresholds below are STARTING values, tuned against the
 * cooperative ground truth (token_echo / mcp sessions, which MUST land
 * agent-shaped) and clearly-browser sessions (which should land human-shaped)
 * during the live-D1 calibration pass in Task 3. Adjust the CALIBRATE constants,
 * not the control flow.
 */

// ── CALIBRATE — starting weights (agent-likelihood contributions) ───────────
// Positive = pushes toward agent-shaped; negative = pushes toward human-shaped.
// Applied on top of NEUTRAL_BASELINE, then clamped to [0, 1].
const NEUTRAL_BASELINE = 0.3; // CALIBRATE — start every non-ground-truth session here

const W = {
  // STRONG agent signals (push up)
  MARKDOWN: 0.5, // browsers never send a text/markdown Accept
  ENDPOINT: 0.4, // agent endpoints: /api/v1/search, /mcp, /agent/*, *.md, llms.txt
  RATIO0_WITH_CONTENT: 0.4, // fetched pages with ~no assets = a bare HTTP client
  // MODERATE agent signals
  INCOHERENT: 0.2, // Sec-Fetch-* header set incoherent
  ONE_FETCH_EACH: 0.15, // distinct_paths sweep with ~one request each
  // STRONG human signals (push down)
  ASSET_HEAVY: -0.4, // real browser pulling CSS/JS/img/favicon
  BROWSER_SHAPED: -0.2, // coherent, multi-request, with some assets
  RESIDENTIAL: -0.2, // residential ISP ASN
};

// ── CALIBRATE — feature thresholds ──────────────────────────────────────────
const ASSET_RATIO_LOW = 0.1; // below this, a "content page" fetch looks tool-like
const ASSET_RATIO_HIGH = 0.5; // at/above this, looks browser-like

// ── CALIBRATE — band cut points on the clamped [0,1] score ──────────────────
const BAND_AGENT = 0.6; // score >= this → agent-shaped
const BAND_HUMAN = 0.3; // score < this  → human-shaped ; between → uncertain

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Score one per-session aggregate row.
 *
 * @param {object} agg  numbers unless noted:
 *   total_requests, distinct_paths, span_ms, content_requests, asset_requests,
 *   markdown_accept, agent_endpoint, sec_fetch_incoherent,
 *   has_token_echo (0|1), has_mcp (0|1), asn_class (string)
 * @returns {{ score:number, band:'human-shaped'|'uncertain'|'agent-shaped',
 *             method:'cooperative'|'session_shape', single_fetch_no_asset:boolean,
 *             signals:object }}
 *
 * `single_fetch_no_asset` is a REPORTING sub-segment, not a scoring change: a
 * session that fetched exactly one content page and pulled zero assets and did
 * NOT already land 'agent-shaped'. A real browser first-paint pulls its CSS/JS/
 * favicon in the same session, so this pattern is likely mostly non-human — but
 * it is unprovable per-session from logs, so it stays scored as 'uncertain' and
 * is only SURFACED as a named sub-segment (held out of the agent count).
 */
export function scoreSession(agg = {}) {
  const total_requests = num(agg.total_requests);
  const distinct_paths = num(agg.distinct_paths);
  const content_requests = num(agg.content_requests);
  const asset_requests = num(agg.asset_requests);
  const markdown_accept = num(agg.markdown_accept);
  const agent_endpoint = num(agg.agent_endpoint);
  const sec_fetch_incoherent = num(agg.sec_fetch_incoherent);
  const has_token_echo = num(agg.has_token_echo);
  const has_mcp = num(agg.has_mcp);
  const asn_class = typeof agg.asn_class === 'string' ? agg.asn_class : 'unknown';

  // Derived evidence features (guard div-by-zero → 0).
  const assetDenom = asset_requests + content_requests;
  const asset_ratio = assetDenom > 0 ? asset_requests / assetDenom : 0;
  const markdown_rate = total_requests > 0 ? markdown_accept / total_requests : 0;
  const endpoint_rate = total_requests > 0 ? agent_endpoint / total_requests : 0;
  const incoherent_rate = total_requests > 0 ? sec_fetch_incoherent / total_requests : 0;

  const signals = {
    asset_ratio,
    markdown_rate,
    endpoint_rate,
    incoherent_rate,
    distinct_paths,
    total_requests,
  };

  // 1. GROUND TRUTH — cooperative agents self-identify. Definite, unconditional.
  if (has_token_echo > 0 || has_mcp > 0) {
    return {
      score: 1,
      band: 'agent-shaped',
      method: 'cooperative',
      single_fetch_no_asset: false,
      signals,
    };
  }

  // 2/3. Weighted session-shape score.
  let score = NEUTRAL_BASELINE;

  // STRONG agent
  if (markdown_rate > 0) score += W.MARKDOWN;
  if (endpoint_rate > 0) score += W.ENDPOINT;
  if (asset_ratio < ASSET_RATIO_LOW && content_requests >= 1) score += W.RATIO0_WITH_CONTENT;
  // MODERATE agent
  if (incoherent_rate > 0) score += W.INCOHERENT;
  if (distinct_paths >= 3 && total_requests <= distinct_paths + 1) score += W.ONE_FETCH_EACH;
  // STRONG human
  if (asset_ratio >= ASSET_RATIO_HIGH) score += W.ASSET_HEAVY;
  if (incoherent_rate === 0 && total_requests >= 3 && asset_ratio > 0) score += W.BROWSER_SHAPED;
  if (asn_class === 'isp_residential') score += W.RESIDENTIAL;

  score = clamp01(score);

  // 4. Band assignment.
  let band;
  if (score >= BAND_AGENT) band = 'agent-shaped';
  else if (score >= BAND_HUMAN) band = 'uncertain';
  else band = 'human-shaped';

  // CAP RULE: a single request that tells us nothing (no markdown, no agent
  // endpoint, no cooperative ground truth) can be AT MOST 'uncertain'. Protects
  // assistive-tech / low-interaction humans who fetch one page and leave.
  if (
    total_requests === 1 &&
    markdown_accept === 0 &&
    agent_endpoint === 0 &&
    band === 'agent-shaped'
  ) {
    band = 'uncertain';
  }

  // REPORTING sub-segment (NOT a scoring change): one content page, zero assets,
  // and not already agent-shaped. Surfaced separately so the internet's biggest
  // ambiguous pattern is visible/trackable rather than buried in 'uncertain'.
  const single_fetch_no_asset =
    total_requests === 1 &&
    asset_requests === 0 &&
    content_requests >= 1 &&
    band !== 'agent-shaped';

  return { score, band, method: 'session_shape', single_fetch_no_asset, signals };
}
