/**
 * scripts/lib/filter-rules/content.rules.js — Audit B content scanner.
 *
 * Phase 3.2.1 (Audit B). FLAG, don't block. Empirical mandate: 236 real
 * records (0.72%) legitimately match curl|sh (install one-liners). Promotion
 * to blocking is manual, via FIXTURE_REPO_DENYLIST (common.rules.js). Scan
 * target is the RAW body (pre-Step-4b truncation) — see filter.js: the
 * annotation pass runs against the 5000-char scraper output, BEFORE
 * body_markdown is truncated to 1500 chars, so payloads at offsets
 * 1500-5000 are visible.
 *
 * These rules are NOT registered in filter-rules/index.js rulePacks and are
 * never called from isSlop — flags are annotations, not gates.
 *
 * Per-rule hit counts in comments are the FP-calibration baseline from the
 * 2026-06-10 scan of the real 33k-record raw corpus.
 */

export const CONTENT_RULES = {
  // --- exfil / malicious-execution class ---
  curl_pipe_sh:      /curl[^\n|]{0,300}\|\s*(?:ba|z|da)?sh\b/,            // 236 hits (0.72%) — mostly legit installers. NEVER block alone.
  wget_pipe_sh:      /wget[^\n|]{0,300}\|\s*(?:ba|z)?sh\b/,               // 6 hits
  base64_decode_exec:/base64\s+(?:-d|--decode)[^\n]{0,120}\|\s*(?:ba|z)?sh\b/, // 2 hits (both security-education)
  env_secret_to_url: /\$\{?[A-Z_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)[A-Z_]*\}?[^\n]{0,200}https?:\/\//, // 58 hits
  exfil_endpoints:   /(webhook\.site|requestbin|pipedream\.net|burpcollaborator|interactsh|oastify\.com)/i,      // 12 hits
  reverse_shell:     /(?:\/dev\/tcp\/\d|nc\s+-e\s+\/bin|mkfifo\s+\/tmp\/)/, // 11 hits (all security-education/pentest)
  // --- jailbreak / prompt-injection class ---
  ignore_previous:   /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier)\s+instructions/i, // 39 hits (fixtures + edu)
  override_system:   /(?:override|bypass)\s+(?:the\s+)?(?:system\s+prompt|safety\s+guidelines|guardrails)/i, // 3 hits
  dan_mode:          /\b(?:DAN mode|do anything now)\b/i,                  // 6 hits
  im_start_system:   /<\|im_start\|>\s*system/,                            // 3 hits
  new_system_prompt: /your\s+new\s+(?:system\s+)?(?:instructions|prompt)\s+(?:are|is)/i, // 0 hits
};

/**
 * Cheap indexOf prefilter tokens (lowercased haystack). A rule with a `pre`
 * token only runs its regex when the token is present; rules without one
 * always run. Belt-and-braces, not load-bearing: the measured full-scan cost
 * WITHOUT any prefilter is 5.1 s / 33k records.
 *
 * @type {Record<string, string>}
 */
const PREFILTERS = {
  curl_pipe_sh: 'curl',
  wget_pipe_sh: 'wget',
  base64_decode_exec: 'base64',
  env_secret_to_url: 'http',
  ignore_previous: 'ignore',
  im_start_system: '<|im_start|>',
};

/**
 * Scan a record's raw content against CONTENT_RULES and return the names of
 * every matching rule, sorted alphabetically (deterministic output).
 *
 * Haystack = body_markdown + description. Raw scraper records are FLAT
 * v1-shape at filterRaw time (record.body_markdown); the extra.* fallback
 * future-proofs for plugin/MCP re-enable in 3.3 (extra.body_markdown via
 * entity-type dispatch, per research note).
 *
 * @param {{ body_markdown?: string, description?: string, extra?: { body_markdown?: string } } | null | undefined} record
 * @returns {string[]} matched rule names, sorted alphabetically
 */
export function scanContentFlags(record) {
  const hay = `${record?.body_markdown ?? record?.extra?.body_markdown ?? ''}\n${record?.description ?? ''}`;
  const hayLower = hay.toLowerCase();

  const flags = [];
  for (const [name, regex] of Object.entries(CONTENT_RULES)) {
    const pre = PREFILTERS[name];
    if (pre && !hayLower.includes(pre)) continue;
    if (regex.test(hay)) flags.push(name);
  }
  return flags.sort();
}
