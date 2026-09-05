---
phase: quick-260905-esm
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - scripts/lib/agent-band.js
  - scripts/lib/agent-band.test.js
  - scripts/agent-band.js
  - scripts/check-banned-patterns.js
  - package.json
  - data/agent-band.json
autonomous: true
requirements:
  - QT-AGENTBAND-01  # offline log-based hidden-agent band: pure scorer + D1 report + sidecar
must_haves:
  truths:
    - "scoreSession(agg) returns {score, band, method, signals} deterministically with no I/O"
    - "token_echo/mcp aggregates score 1.0 / agent-shaped via the cooperative ground-truth shortcut"
    - "A browser-shaped aggregate (asset_ratio≈1, coherent, residential) lands human-shaped"
    - "A markdown-accept OR asset_ratio≈0-with-content aggregate lands agent-shaped/uncertain"
    - "A single-request no-tell aggregate is capped at uncertain, never agent-shaped"
    - "scripts/agent-band.js runs read-only against live D1 and prints all 5 report sections"
    - "No ip_hash value is ever selected or printed — only GROUP BY on ip_hash"
    - "Any failure (missing env, fetch error, non-success D1) → console.warn + exit(0), never throws"
    - "data/agent-band.json is written atomically (tmp+rename) with aggregate metrics only, no per-session rows"
  artifacts:
    - path: "scripts/lib/agent-band.js"
      provides: "Pure scoreSession scorer + derived-feature helpers, zero I/O, ESM"
      exports: ["scoreSession"]
    - path: "scripts/lib/agent-band.test.js"
      provides: "Unit tests: ground-truth shortcut, browser→human, markdown/ratio0→agent, single-req→uncertain cap"
    - path: "scripts/agent-band.js"
      provides: "D1 read-only aggregation + 5-section console report + bounded sidecar write"
    - path: "data/agent-band.json"
      provides: "Bounded aggregate sidecar (band dist + component breakdown + window)"
    - path: "scripts/check-banned-patterns.js"
      contains: "scripts/agent-band.js allowlist entry"
  key_links:
    - from: "scripts/agent-band.js"
      to: "scripts/lib/agent-band.js"
      via: "import { scoreSession }"
      pattern: "import.*scoreSession.*agent-band"
    - from: "scripts/agent-band.js"
      to: "D1 request_log"
      via: "GROUP BY (day, ip_hash, user_agent) conditional-SUM aggregation over HTTP /query"
      pattern: "GROUP BY"
---

<objective>
Build the log-based hidden-agent band: an offline, read-only analysis of the existing
Cloudflare D1 `request_log` that computes a per-session agent-likelihood band
(human-shaped / uncertain / agent-shaped) from log signals only, so Dan can LOOK AT
THE DATA and quantify "agents hiding in the human bucket."

Purpose: turn the "agents hiding in the human bucket" finding into an ongoing
probabilistic measurement, evidence-bearing (component signals), calibrated against
cooperative ground truth (token_echo / mcp). NO live worker change, NO client beacon,
NO PII.

Output:
- `scripts/lib/agent-band.js` — pure, unit-tested scorer.
- `scripts/agent-band.js` — D1 read-only aggregator + console report (the PRIMARY deliverable).
- `data/agent-band.json` — bounded aggregate sidecar.
- allowlist + optional npm script.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@scripts/snapshot-traffic.js
@scripts/check-banned-patterns.js
@worker/request-log.js
@worker/classify.js
@docs/agent-analytics-research/04-detection-sota.md

<interfaces>
<!-- Contracts the executor needs. Use directly — no codebase exploration required. -->

request_log columns (worker/request-log.js REQUEST_LOG_COLUMNS, verbatim):
  timestamp (INTEGER, ms since epoch), path, method, status, user_agent, asn, as_org,
  country, accept_header, sec_fetch_coherent (0|1|null), class, operator, confidence,
  classifier_method, signature_agent, wba_status, wba_signer, ip_hash (daily-salted),
  agent_token, mcp_client, asn_class ('hosting'|'isp_residential'|'unknown')

class domain (worker/classify.js): 'human' | 'agent' | 'crawler' | 'automated_unknown'
  | 'impersonation_suspected' | 'unknown'
classifier_method values incl.: 'token_echo', 'mcp' (the DEFINITE-agent ground truth),
  'ua_list', 'ua_asn_mismatch', 'no_ua', 'coherent_datacenter', 'coherence', 'default'

D1 REST helper pattern (scripts/snapshot-traffic.js, mirror EXACTLY):
  DATABASE_ID = 'd4e341fa-17d6-4069-8a00-3b6a8d698ab9'  (scripts/snapshot-traffic.js line 48)
  queryUrl(accountId) → https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${DATABASE_ID}/query
  async d1Query(url, token, sql): POST {sql}, Bearer token; throws on !res.ok || json.success===false
  rowsOf(json): json.result.flatMap(r => r.results || [])
  DAY_EXPR = "strftime('%Y-%m-%d', timestamp/1000, 'unixepoch')"  // timestamp is MILLISECONDS
  writeJsonAtomic(path, obj): openSync tmp → writeSync JSON.stringify(obj,null,2)+'\n' → renameWithRetry
  main(): env-check FIRST (CF_ACCOUNT_ID + CF_API_TOKEN) → console.warn + exit(0) if absent;
          try/catch wraps all D1 work → console.warn + exit(0) on ANY failure; never throws.
  invoked-as-script guard so tests can import without running main().

  DATABASE_ID is 'd4e341fa-17d6-4069-8a00-3b6a8d698ab9'. To be safe, COPY it verbatim from
  scripts/snapshot-traffic.js line 48 rather than retyping — a transposition typo would break
  every query (which then just warns + exits 0, silently producing no report).
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure scoring module + unit tests (scripts/lib/agent-band.js + .test.js)</name>
  <files>scripts/lib/agent-band.js, scripts/lib/agent-band.test.js</files>
  <behavior>
    Write the tests FIRST (node:test + node:assert, mirror scripts/lib/slug.test.js style),
    then implement scoreSession until green. Required test cases:
    - Ground truth: agg with has_token_echo=1 → { score:1, band:'agent-shaped', method:'cooperative' }.
      Same for has_mcp=1.
    - Browser-shaped human: agg with high asset_ratio (assets≈content*4, content_requests≥1),
      incoherent_rate=0, asn_class='isp_residential', multi-request, no markdown/endpoint
      → band:'human-shaped' (score<0.3).
    - Agent via markdown: agg with markdown_accept>0 → band 'agent-shaped' or 'uncertain'
      (score≥0.3); assert NOT 'human-shaped'.
    - Agent via asset_ratio≈0 with content: agg with asset_requests=0, content_requests≥3,
      total_requests≥3, no markdown → band 'agent-shaped' (score≥0.6).
    - Single-request no-tell cap: agg total_requests=1, no markdown, no endpoint, asset_requests=0
      → band 'uncertain' (NOT 'agent-shaped') even if raw score would be high.
    - signals object is returned and contains the derived features (asset_ratio, markdown_rate,
      endpoint_rate, incoherent_rate) so the report can show evidence.
  </behavior>
  <action>
    Create `scripts/lib/agent-band.js` (ESM, ZERO I/O — no imports of fs/fetch; importable by
    both the script and the test). Export `scoreSession(agg) → { score, band, method, signals }`.

    Input `agg` is one per-session aggregate row (numbers): total_requests, distinct_paths,
    span_ms, content_requests, asset_requests, markdown_accept, agent_endpoint,
    sec_fetch_incoherent, has_token_echo (0|1), has_mcp (0|1), asn_class (string).

    Logic:
    1. GROUND TRUTH: if has_token_echo OR has_mcp → return { score:1, band:'agent-shaped',
       method:'cooperative', signals:{...} }.
    2. Else derive features (guard div0):
         asset_ratio = asset_requests / (asset_requests + content_requests)  (0 if denom 0)
         markdown_rate = markdown_accept / total_requests
         endpoint_rate = agent_endpoint / total_requests
         incoherent_rate = sec_fetch_incoherent / total_requests
    3. Weighted agent-likelihood from a DOCUMENTED starting weight set (constants at top of
       file, clearly commented "CALIBRATE — starting values"). Suggested starting weights:
         STRONG agent (push up):
           markdown_rate>0            → +0.5  (browsers never send text/markdown Accept)
           endpoint_rate>0            → +0.4  (agent endpoints: /api/v1/search, /mcp, .md, llms.txt)
           asset_ratio<0.1 AND content_requests>=1 → +0.4 (fetched pages, ~no assets = HTTP client)
         MODERATE agent:
           incoherent_rate>0          → +0.2
           distinct_paths>=3 AND total_requests <= distinct_paths+1 → +0.15 (one-fetch-each sweep)
         STRONG human (push down):
           asset_ratio>=0.5           → -0.4  (real browser pulling CSS/JS/img/favicon)
           incoherent_rate==0 AND total_requests>=3 AND asset_ratio>0 → -0.2 (browser-shaped)
           asn_class=='isp_residential' → -0.2
       Clamp score to [0,1] (start from a 0.3 neutral baseline, or 0 — planner's call; document it).
    4. BANDS (starting thresholds, comment "CALIBRATE"):
         score>=0.6 → 'agent-shaped'; 0.3<=score<0.6 → 'uncertain'; score<0.3 → 'human-shaped'.
       CAP RULE: if total_requests==1 AND markdown_accept==0 AND agent_endpoint==0 AND has no
       cooperative ground truth → band may be AT MOST 'uncertain' (never 'agent-shaped'),
       protecting assistive-tech / low-interaction humans.
    5. method = 'cooperative' for ground truth, else 'session_shape'.
    6. Return signals:{ asset_ratio, markdown_rate, endpoint_rate, incoherent_rate,
       distinct_paths, total_requests } for evidence display.

    Add a header comment documenting: (a) session = (ip_hash, user_agent) within one UTC day;
    (b) the daily-salt limitation — the same real client appears as a different ip_hash each day,
    so sessions are per-day only (accepted for this measurement).
  </action>
  <verify>
    <automated>node --test scripts/lib/agent-band.test.js</automated>
  </verify>
  <done>All unit tests pass: ground-truth shortcut, browser→human-shaped, markdown/ratio0→agent-shaped, single-request no-tell→uncertain cap. Module has zero I/O imports.</done>
</task>

<task type="auto">
  <name>Task 2: D1 read-only aggregator + 5-section report + sidecar (scripts/agent-band.js)</name>
  <files>scripts/agent-band.js</files>
  <action>
    Create `scripts/agent-band.js` (ESM, Node 22, global fetch, NO wrangler). MIRROR
    scripts/snapshot-traffic.js exactly for: D1 REST auth/query helper (queryUrl, d1Query,
    rowsOf), DATABASE_ID (COPY the exact string from snapshot-traffic.js line 48 —
    'd4e341fa-17d6-4069-8a00-3b6a8d698ab9'), env handling (CF_ACCOUNT_ID + CF_API_TOKEN via
    `node --env-file=.env`), robustness (env-check FIRST → warn+exit(0); try/catch around all D1
    work → warn+exit(0); NEVER throw, NEVER exit non-zero), writeJsonAtomic (tmp+rename), and the
    invoked-as-script guard. Import scoreSession from ./lib/agent-band.js.

    ONE per-session aggregation query (the table is ~1.7M rows — NEVER pull per-request rows;
    do the aggregation IN SQL). Default window: last 7 days
    (WHERE timestamp > <Date.now() - 7*86400*1000>). GROUP BY:
      strftime('%Y-%m-%d', timestamp/1000, 'unixepoch') AS day, ip_hash, user_agent
    NEVER SELECT ip_hash or user_agent as printable output beyond grouping — the SELECT list
    returns ONLY aggregates (and day if useful); ip_hash appears ONLY in GROUP BY. Per-session
    conditional-SUM aggregates:
      total_requests = COUNT(*)
      distinct_paths = COUNT(DISTINCT path)
      span_ms        = MAX(timestamp) - MIN(timestamp)
      asset_requests = SUM(CASE WHEN <ASSET_TEST> THEN 1 ELSE 0 END)
      content_requests = total_requests - asset_requests   (content = NOT asset)
      markdown_accept = SUM(CASE WHEN accept_header LIKE '%text/markdown%' THEN 1 ELSE 0 END)
      agent_endpoint = SUM(CASE WHEN path LIKE '/api/v1/search%' OR path='/mcp'
                        OR path LIKE '/agent/%' OR path LIKE '%llms.txt%' OR path LIKE '%.md'
                        THEN 1 ELSE 0 END)
      sec_fetch_incoherent = SUM(CASE WHEN sec_fetch_coherent = 0 THEN 1 ELSE 0 END)
      has_token_echo = MAX(CASE WHEN classifier_method='token_echo' THEN 1 ELSE 0 END)
      has_mcp        = MAX(CASE WHEN classifier_method='mcp' THEN 1 ELSE 0 END)
      session_class  = MAX(class)   -- for scoping: whether class IN ('human','unknown')
      asn_class      = MAX(asn_class)
    ASSET_TEST (path is a bare pathname, no query string):
      path LIKE '/_astro/%' OR path LIKE '%.css' OR path LIKE '%.js' OR path LIKE '%.png'
      OR path LIKE '%.svg' OR path LIKE '%.ico' OR path LIKE '%.woff' OR path LIKE '%.woff2'
      OR path LIKE '%.jpg' OR path LIKE '%.jpeg' OR path LIKE '%.webp' OR path LIKE '/favicon%'

    NOTE: D1 caps rows-per-response (~10k). Guard: if the query returns the max page size,
    console.warn that results may be truncated (acceptable for a look-at-data first pass;
    document a follow-up to add LIMIT/OFFSET paging if session count exceeds the cap). Do NOT
    add paging complexity now unless the count actually hits the cap.

    For each returned session row, call scoreSession(agg). Build the report and the sidecar.

    CONSOLE REPORT (the PRIMARY deliverable) — print all 5 sections with clear headers:
      1. Window (from → to, days) + total sessions scored.
      2. Band distribution over the AMBIGUOUS POOL (sessions whose session_class ∈ {human, unknown}):
         counts + % for agent-shaped / uncertain / human-shaped — the headline "hidden agent in
         the human bucket" estimate.
      3. Component-signal breakdown of the ambiguous pool: % of sessions with markdown_rate>0,
         endpoint hits, asset_ratio<0.1, incoherent_rate>0, one-fetch-each sweep.
      4. Calibration check: where DEFINITE-agent sessions (has_token_echo OR has_mcp) land
         (MUST be agent-shaped), AND where clearly-human sessions (asset_ratio>=0.5 AND
         incoherent_rate=0 AND asn_class='isp_residential') land (should be human-shaped).
         Print both distributions so weights can be eyeballed.
      5. Estimated hidden-agent RANGE: "agent-shaped: N; range incl. half the uncertain bucket:
         N–M sessions".

    SIDECAR: write `data/agent-band.json` via writeJsonAtomic — aggregate metrics ONLY:
      { generated_at, window:{from,to,days}, total_sessions, ambiguous_pool:{...band dist...},
        component_breakdown:{...}, calibration:{ definite_agent:{...}, clearly_human:{...} },
        estimated_hidden_agents:{ agent_shaped, range_low, range_high } }
    NO per-session rows, NO ip_hash, NO user_agent. Bounded — a few KB regardless of table size.
  </action>
  <verify>
    <automated>node -e "import('./scripts/agent-band.js').then(()=>console.log('import-ok'))"</automated>
  </verify>
  <done>Module imports without running main() (guard works); SQL does all aggregation via GROUP BY; report prints 5 sections; sidecar written atomically with aggregate-only metrics; robustness paths (missing env / D1 failure) warn+exit(0).</done>
</task>

<task type="auto">
  <name>Task 3: Housekeeping (allowlist + npm script) + live-D1 VERIFY & calibration</name>
  <files>scripts/check-banned-patterns.js, package.json, data/agent-band.json</files>
  <action>
    1. In scripts/check-banned-patterns.js LINT_ALLOWLIST, add a whole-file entry for
       `scripts/agent-band.js` (the WRITER of data/agent-band.json), same shape as the
       `scripts/snapshot-traffic.js` entry, so its JSON.stringify(obj,null,2) (Banned B) on the
       bounded sidecar passes. Reason string: bounded per-day D1 aggregate summary; no unbounded
       data/ reads (D1 REST, not readFileSync). NOTE: the allowlist keys on the SOURCE file that
       contains the JSON.stringify, not on the output file — mirror how snapshot-traffic.js is listed.
    2. Confirm data/agent-band.json is committable: verify there is NO broad `data/` gitignore
       entry that would exclude it (mirror data/traffic-snapshot.json, which IS committed).
       Run `git check-ignore data/agent-band.json` — expect NO output (not ignored). If it IS
       ignored, add a `!data/agent-band.json` negation next to the traffic-snapshot exception.
    3. package.json: add `"agent-band": "node scripts/agent-band.js"` to scripts (nice-to-have).
    4. Do NOT wire into the cron (look-at-data build first).

    LIVE VERIFY (the primary deliverable — executor MUST do this and paste output into SUMMARY):
      Run `node --env-file=.env scripts/agent-band.js` against live D1.
      - Confirm the report renders all 5 sections.
      - CALIBRATION: confirm token_echo/mcp sessions land 'agent-shaped' (if not, the ground-truth
        shortcut is broken — fix Task 1). Tune the weights in scripts/lib/agent-band.js so
        clearly-browser sessions land 'human-shaped' and markdown-accept sessions surface as
        agent-shaped/uncertain. Re-run until calibration section looks sane.
      - Paste the REAL band distribution (section 2) + calibration lines (section 4) into SUMMARY
        so Dan can look at the numbers.
      - Re-run `node --test scripts/lib/agent-band.test.js` after any weight tuning to keep tests
        green (update test expectations only if the tuned thresholds legitimately shift a case).
    Then run the gates below.
  </action>
  <verify>
    <automated>npm run check:patterns && node --test scripts/lib/agent-band.test.js</automated>
  </verify>
  <done>check:patterns clean (agent-band.js allowlisted); data/agent-band.json not gitignored; `npm run agent-band` script present; live-D1 run rendered all 5 sections; token_echo/mcp calibrated to agent-shaped; real band distribution + calibration lines pasted into SUMMARY; unit tests green; `npm test` count unchanged (2 known embed-skills fails OK).</done>
</task>

</tasks>

<verification>
- `node --test scripts/lib/agent-band.test.js` — pure scorer tests green (ground truth, browser→human, markdown/ratio0→agent, single-req→uncertain cap).
- `node --env-file=.env scripts/agent-band.js` against live D1 renders all 5 report sections; token_echo/mcp sessions calibrate to agent-shaped; clearly-browser sessions to human-shaped.
- `npm run check:patterns` clean (scripts/agent-band.js allowlisted).
- `npm test` overall count unchanged vs baseline (the 2 known embed-skills fails are pre-existing and OK).
- `git check-ignore data/agent-band.json` → no output (committable).
- No ip_hash / user_agent value printed or written anywhere; only GROUP BY on ip_hash.
- Missing-env and D1-failure paths warn + exit(0) (never throw, never non-zero).
</verification>

<success_criteria>
- Dan can run one command and read a clear console report quantifying "hidden agents in the human bucket," with an evidence breakdown and a self-calibration section.
- Pure scorer is unit-tested and calibrated against cooperative ground truth.
- Bounded, committable `data/agent-band.json` sidecar with aggregate-only metrics.
- Zero live-worker / classify.js changes; offline read-only analysis only.
- Atomic conventional commits; NOT pushed (orchestrator reviews the data first).
</success_criteria>

<output>
After completion, create `.planning/quick/260905-esm-log-based-hidden-agent-band-scripts-agen/260905-esm-SUMMARY.md`.
MUST include: the real band distribution (report section 2) + calibration lines (section 4) pasted verbatim from the live-D1 run, so Dan can look at the numbers.
</output>
