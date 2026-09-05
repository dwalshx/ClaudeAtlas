---
phase: quick-260905-fib
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/beh-score.js
  - src/lib/beh-score.test.js
  - worker/beh.js
  - worker/beh.test.js
  - worker/index.js
  - worker/schema.sql
  - src/layouts/BaseLayout.astro
  - package.json
autonomous: true
requirements:
  - BEH-01   # Pure structural scorer: automation-signature / human-shaped / uncertain
  - BEH-02   # Client beacon: activate-gated capture, aggregate-only, sendBeacon egress
  - BEH-03   # Worker routes: /api/v1/beh/activate geo-gate + POST /api/v1/beh ingest
  - BEH-04   # D1 behavior_log table (identifier-free) via lazy-create pattern
  - PRIV-01  # Raw events never leave browser / never stored (aggregate numbers only)
  - PRIV-02  # EU/EEA/UK never instrumented (activate-gate + defense-in-depth drop)
  - PRIV-03  # No device identifier stored (no ip_hash, no cookie, no nonce)
  - PRIV-04  # Keystrokes = count only, never identities or per-key timing

must_haves:
  truths:
    - "A non-EU visitor who moves the mouse, scrolls, and clicks produces exactly one behavior_log row per pageview (aggregate numbers + score + band)."
    - "An EU/EEA/UK visitor is never instrumented: /api/v1/beh/activate returns {activate:false}, no listeners attach, no POST is made, and a POST that reaches the worker anyway is dropped."
    - "Automation-shaped features (clicks present but mouse_event_rate ~0, has_wheel=false, high teleport_click_ratio) score band 'automation-signature'."
    - "Human-shaped features (healthy mouse_event_rate, has_wheel=true, low teleport ratio, varied click_duration_spread) score band 'human-shaped'."
    - "Near-zero-interaction features (read-and-left, assistive-tech/keyboard-only) score band 'uncertain', NEVER 'automation-signature'."
    - "No raw event stream, coordinate, key identity, per-key timing, or device identifier is ever stored client-side or in D1 — only ~10 aggregate numbers, the score, and the band."
    - "The beacon never throws visibly and never affects page rendering or perceived performance (passive listeners, sendBeacon, all try/caught)."
  artifacts:
    - path: "src/lib/beh-score.js"
      provides: "Pure ESM scoreBehavior(features) -> {score, band, signals}; zero I/O; importable by client bundle AND node --test"
      exports: ["scoreBehavior"]
      min_lines: 60
    - path: "src/lib/beh-score.test.js"
      provides: "Unit tests for the four band outcomes + biometric-line (keydown count only) invariant"
      min_lines: 40
    - path: "worker/beh.js"
      provides: "Pure geo/ingest logic — EU_EEA_UK set, activate decision, payload validation/clamp, behavior_log DDL + lazy-create insert, route handlers"
      exports: ["EU_EEA_UK", "isEuCountry", "decideActivate", "validateBehPayload", "handleBehActivate", "handleBehIngest", "BEHAVIOR_LOG_DDL", "BEHAVIOR_LOG_COLUMNS"]
      min_lines: 90
    - path: "worker/beh.test.js"
      provides: "Unit tests — EU vs US activate, payload reject-oversize/junk + clamp, EU POST dropped"
      min_lines: 40
    - path: "worker/schema.sql"
      provides: "behavior_log DDL as source of truth (identifier-free)"
      contains: "CREATE TABLE IF NOT EXISTS behavior_log"
  key_links:
    - from: "src/layouts/BaseLayout.astro"
      to: "/api/v1/beh/activate"
      via: "fetch on load before any listener attaches"
      pattern: "fetch\\(['\"]/api/v1/beh/activate"
    - from: "src/layouts/BaseLayout.astro"
      to: "src/lib/beh-score.js"
      via: "import scoreBehavior into the client <script>"
      pattern: "import .*scoreBehavior.* from ['\"].*beh-score"
    - from: "src/layouts/BaseLayout.astro"
      to: "/api/v1/beh"
      via: "navigator.sendBeacon on pagehide/visibilitychange"
      pattern: "sendBeacon\\(['\"]/api/v1/beh"
    - from: "worker/index.js"
      to: "worker/beh.js"
      via: "import handlers, route both /api/v1/beh paths before the ASSETS fallthrough"
      pattern: "from ['\"]\\./beh\\.js"
    - from: "worker/beh.js"
      to: "env.DB behavior_log"
      via: "ctx.waitUntil non-blocking INSERT with lazy CREATE-on-no-such-table"
      pattern: "behavior_log"
---

<objective>
Build the behavioral beacon (L4 in docs/agent-analytics-research/04-detection-sota.md §7): a client-side, privacy-scoped instrument that captures STRUCTURAL interaction aggregates in the browser, scores an automation-likelihood band IN THE BROWSER, and POSTs only ~10 aggregate numbers + the score + band to the worker. It catches the one agent class logs cannot see — agentic browsers (ChatGPT Atlas, Claude-in-Chrome, Perplexity Comet) that run real Chrome from residential IPs but EXECUTE JS, so their input-event structure betrays automation. This COMPLEMENTS (does not replace) the log-based band already shipped in request_log.

Purpose: extend agent-traffic measurement to class E/F visitors while honoring Dan's hard privacy invariants (aggregate-only, EU/EEA/UK never instrumented, no device identifier, keystroke COUNT only).
Output: pure scorer module + tests, worker geo/ingest logic + routes + tests, client beacon in BaseLayout, and the identifier-free behavior_log D1 table.

The design below is SETTLED. Implement it; do not redesign. A reporting query over behavior_log is a FOLLOW-UP, explicitly OUT OF SCOPE (do NOT wire any cron).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md

# Established patterns to mirror (already read during planning; re-open as needed):
@worker/request-log.js        # lazy CREATE-on-"no such table" + MISSING_COLUMN_RE incident regex; ctx.waitUntil; buildLogRow purity; INSERT column-order pattern
@worker/asn-class.js          # canonical pure-module shape (zero imports, zero I/O, named exports, never-throws)
@worker/index.js              # route wiring: url.pathname checks BEFORE the env.ASSETS fallthrough; corsPreflightResponse; jsonResponse; ctx.waitUntil in default export
@worker/schema.sql            # source-of-truth DDL (search_events / agent_pings / request_log)
@src/layouts/BaseLayout.astro # where the client beacon <script> goes; existing is:inline analytics delegation script + PostHog ENABLED-gate idiom
@src/lib/analytics.js         # existing client-side style (ENABLED-gating, never-throws)

<interfaces>
<!-- Contracts the executor implements against. No codebase exploration needed. -->

# src/lib/beh-score.js — PURE, zero I/O, importable by client bundle AND node --test
export function scoreBehavior(features) -> {
  score: number,                    // 0..1 (higher = more automation-like)
  band: 'human-shaped' | 'uncertain' | 'automation-signature',
  signals: { [componentName: string]: number }   // evidence-bearing per-signal contributions
}

# features (ALL structural aggregates — the ~10 numbers the client computes):
#   mouse_event_rate        number   mousemove events / second over the session
#   has_wheel               boolean  any wheel event seen (Playwright has NO scroll.wheel() — strong tell)
#   wheel_count             number
#   teleport_click_ratio    number   0..1; clicks with no mousemove in ~500ms/~100px before them ÷ click_count
#   click_count             number
#   pointer_move_count      number
#   keydown_count           number   COUNT ONLY — the biometric tripwire
#   session_ms              number
#   click_duration_spread   number   std of mousedown->mouseup ms (aggregate only)
#   interaction_total       number   sum of interaction events (mousemove+wheel+click+pointer+keydown)

# worker/beh.js — PURE logic (mirror worker/asn-class.js shape) + thin route handlers
export const EU_EEA_UK: Set<string>                          // 27 EU + IS,LI,NO + GB
export function isEuCountry(country: string): boolean
export function decideActivate(country: string, env): { activate: boolean }   // false for EU/EEA/UK or feature-flag-off
export function validateBehPayload(body): { ok: boolean, row?: object, reason?: string }  // bounded size, numeric clamp, reject junk
export async function handleBehActivate(request, env): Response               // GET; JSON {activate}; no caching (varies by country)
export async function handleBehIngest(request, env, ctx): Response            // POST; double-check EU-drop; ctx.waitUntil insert; 204/202 fast
export const BEHAVIOR_LOG_DDL: string[]                       // kept IN SYNC with worker/schema.sql
export const BEHAVIOR_LOG_COLUMNS: string[]                   // INSERT bind order (minus autoincrement id)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Pure structural scorer src/lib/beh-score.js + tests</name>
  <files>src/lib/beh-score.js, src/lib/beh-score.test.js, package.json</files>
  <behavior>
    Write tests FIRST (RED), then implement (GREEN). Cases:
    - Automation-signature: click_count>0 but mouse_event_rate ~0 (clicked without moving) → band 'automation-signature'.
    - Automation-signature: has_wheel=false with real interaction present pushes score up → 'automation-signature'.
    - Automation-signature: high teleport_click_ratio (e.g. >0.7) with clicks present → 'automation-signature'.
    - Human-shaped: healthy mouse_event_rate (e.g. >5/s) + has_wheel=true + low teleport ratio + varied click_duration_spread → 'human-shaped'.
    - Uncertain (CRITICAL false-positive guard): near-zero interaction_total (a human who read and left, or assistive-tech/keyboard-only nav — e.g. only a few keydowns, no mouse) → 'uncertain', NOT 'automation-signature'. Add an explicit assistive-tech case: keydown_count>0, mouse_event_rate=0, click_count=0, has_wheel=false → MUST be 'uncertain', not automation.
    - Biometric line: scoreBehavior reads keydown_count as a COUNT scalar only. Test that the function signature/output never depends on any per-key identity or timing array (features carry no such field; assert result is stable/defined for count-only input).
    - Returns a non-empty `signals` object with the component contributions.
  </behavior>
  <action>
    Create `src/lib/beh-score.js` as a pure ESM module (zero I/O, zero imports — mirror the worker/asn-class.js discipline; never throws, defensive on missing/NaN fields treated as 0/false). Export `scoreBehavior(features)`.

    Scoring approach (provide STARTING weights/thresholds; add a comment that they will be calibrated post-deploy against sessions the log-based band already flagged — per BEH-01 and §04-detection-sota §1.4 minimal validated set {mouse_event_rate, teleport_click_ratio, wheel absence}):
    - Compute a 0..1 automation score from a small weighted sum of component signals: low-mouse-rate-with-clicks, wheel-absence-with-interaction, high-teleport-ratio, low-pointer-move-with-interaction, low click_duration_spread. Return each component in `signals`.
    - EXPLICIT UNCERTAIN MIDDLE: FIRST gate on interaction_total — if total interaction is below a low threshold (near-zero), return band 'uncertain' immediately regardless of score. NEVER label near-zero-interaction as automation (the assistive-tech / keyboard-only false positive we must avoid — §04-detection-sota §7 "never let missing-signal become evidence-of-automation" + the "NEVER deploy a single behavioral feature" rule).
    - Otherwise apply conservative band thresholds: score >= high cutoff → 'automation-signature'; score <= low cutoff → 'human-shaped'; between → 'uncertain' (uncertain absorbs ambiguity).
    - Keystrokes: use keydown_count as a scalar count ONLY. Do NOT reference any per-key timing/identity (none is passed) — this is the biometric tripwire (PRIV-04).

    Write `src/lib/beh-score.test.js` using `node:test` + `node:assert/strict` (mirror worker/asn-class.test.js import style).

    In `package.json`, extend the `test` script glob to also match the new src/lib test so it joins the suite: change
      "test": "node --test \"scripts/**/*.test.js\" \"worker/**/*.test.js\""
    to
      "test": "node --test \"scripts/**/*.test.js\" \"worker/**/*.test.js\" \"src/lib/**/*.test.js\""
    (additive — do not remove the existing globs).
  </action>
  <verify>
    <automated>node --test src/lib/beh-score.test.js</automated>
  </verify>
  <done>All beh-score tests pass: automation-shaped → 'automation-signature', human-shaped → 'human-shaped', near-zero-interaction AND assistive-tech case → 'uncertain', has_wheel=false pushes toward automation, biometric line (count-only) respected. `signals` returned. package.json test glob includes src/lib.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Worker geo/ingest logic worker/beh.js + tests + index.js routes + schema.sql DDL</name>
  <files>worker/beh.js, worker/beh.test.js, worker/index.js, worker/schema.sql</files>
  <behavior>
    Tests FIRST (RED) for the PURE logic (these take plain scalars / mocked Request objects — no Worker runtime, no network, mirror worker/asn-class.test.js + worker/request-log.test.js):
    - isEuCountry: 'DE','FR','GB','NO','IS','LI' → true; 'US','CA','JP' → false.
    - decideActivate: EU country → {activate:false}; US → {activate:true}; feature-flag-off env → {activate:false}.
    - validateBehPayload: rejects oversize junk (huge/extra fields, wrong types), rejects non-numeric feature fields; CLAMPS out-of-range numbers to sane bounds; accepts a well-formed payload and returns a row object with only the expected columns.
    - handleBehIngest EU-drop (defense in depth): a POST whose request.cf.country is EU is dropped silently (no DB write attempted) and still returns a fast 2xx.
    - buildBehRow / row assembly: contains NO ip_hash and NO identifier field (assert the row keys are exactly the behavior_log columns, none of which is an identifier).
  </behavior>
  <action>
    Create `worker/beh.js` mirroring worker/asn-class.js (pure exports) + worker/request-log.js (lazy-migration + waitUntil insert) patterns:

    1. `EU_EEA_UK` — Set of the 27 EU members + IS, LI, NO + GB (UK GDPR). Put the full ISO-3166 alpha-2 list here.
    2. `isEuCountry(country)` — membership test, never throws.
    3. `decideActivate(country, env)` — returns {activate:false} when isEuCountry OR a feature flag disables it (e.g. env.BEH_BEACON_ENABLED === 'false'); else {activate:true}. Default ON when the flag is unset (only 'false' disables), so no wrangler/secret change is required to ship.
    4. `validateBehPayload(body)` — bounded: reject if JSON string/object exceeds a small size cap; require the expected numeric feature fields (coerce to Number, reject NaN/Infinity), clamp each to sane min/max; `score` clamped 0..1; `band` must be one of the three enum strings; `path` truncated (e.g. 256 chars). Returns {ok:true,row} or {ok:false,reason}. NEVER accept or store any identifier, coordinate stream, or key value.
    5. `BEHAVIOR_LOG_COLUMNS` (INSERT bind order, minus id): timestamp, path, country, mouse_event_rate, has_wheel, wheel_count, teleport_click_ratio, click_count, pointer_move_count, keydown_count, session_ms, click_duration_spread, interaction_total, score, band. NO ip_hash, NO identifier.
    6. `BEHAVIOR_LOG_DDL` — array with `CREATE TABLE IF NOT EXISTS behavior_log (...)` (columns above; has_wheel stored as INTEGER 0/1) + a timestamp index. Kept IN SYNC with worker/schema.sql (import-free duplicate, same rationale as REQUEST_LOG_DDL). Mirror the lazy CREATE-on-"no such table" retry-once pattern; reuse the incident-fixed `MISSING_COLUMN_RE = /no such column|has no column named/i` for any FUTURE ADD COLUMN path (do NOT regress that regex). Module-level at-most-once migration guard like request-log.js.
    7. `handleBehActivate(request, env)` — GET; read request.cf.country; return `jsonResponse`-style JSON {activate} with CORS `access-control-allow-origin: *` and `cache-control: no-store` (MUST vary by country — never cache).
    8. `handleBehIngest(request, env, ctx)` — POST; parse JSON in try/catch; DOUBLE-CHECK request.cf.country not EU (defense in depth — drop silently, return fast 204 if EU); validateBehPayload; on invalid → 204/400 fast without DB write; on valid → build row (timestamp=Date.now(), country from request.cf, path from payload), and log to D1 via `ctx.waitUntil` (non-blocking, lazy-create on first insert). Return 204/202 fast REGARDLESS of the insert outcome. All wrapped so it never throws.

    Wire into `worker/index.js` (thin glue, ADDITIVE, BEFORE the env.ASSETS fallthrough, all try/caught — do not disturb existing routes or the OPTIONS preflight block; extend the preflight `startsWith('/api/')` already covers these paths):
    - `import { handleBehActivate, handleBehIngest } from './beh.js';` near the other worker-module imports.
    - In handleFetch, add: `if (url.pathname === '/api/v1/beh/activate') return handleBehActivate(request, env);` and `if (url.pathname === '/api/v1/beh') return handleBehIngest(request, env, ctx);` alongside the other `/api/v1/*` route checks.

    Add the behavior_log DDL to `worker/schema.sql` as source of truth (mirror the request_log block's commenting: identifier-free note, OPERATOR STEP note that wrangler can't run on win32-arm64 so the LIVE table is created lazily on first insert via the worker's own DB binding; IF NOT EXISTS makes re-apply safe). Explicitly note NO ip_hash / NO identifier (PRIV-03).

    Write `worker/beh.test.js` (node:test + node:assert/strict). For handler tests, construct a minimal mock request `{ method, cf:{country}, json: async()=>({...}) }` and a mock env `{ DB: { prepare(){...} } }` capturing whether prepare/run was called — assert EU POST performs NO DB write.
  </action>
  <verify>
    <automated>node --test worker/beh.test.js</automated>
  </verify>
  <done>worker/beh.js exports the pure logic + handlers; all beh tests pass (EU vs US activate, payload reject/clamp, EU POST dropped with no DB write, row carries no identifier). index.js routes both /api/v1/beh paths before the ASSETS fallthrough (grep: `from './beh.js'`, both pathname checks present). schema.sql contains the identifier-free behavior_log DDL. Existing routes untouched.</done>
</task>

<task type="auto">
  <name>Task 3: Client beacon in src/layouts/BaseLayout.astro</name>
  <files>src/layouts/BaseLayout.astro</files>
  <action>
    Add an Astro client `<script>` block (a bundled module script, NOT is:inline — so Astro/Vite bundles the `import { scoreBehavior } from '../lib/beh-score.js'`). Place it near the existing analytics delegation script. Everything inside a single top-level try/catch; the beacon must NEVER affect page behavior or throw visibly (PRIV/constraints).

    Flow:
    1. On load: `fetch('/api/v1/beh/activate')` → parse `{activate}`. If not truthy (EU/EEA/UK or feature-flagged off) → do NOTHING: attach NO listeners, capture NOTHING, POST NOTHING (PRIV-02). Return early.
    2. If activate: attach PASSIVE listeners (`{passive:true}` where applicable) for: mousemove, wheel, click (with mousedown/mouseup to measure durations), pointermove, keydown. Listeners ONLY increment counters / accumulate aggregate stats:
       - mousemove → pointer/mouse move counters + track for teleport detection (keep only the LAST move's timestamp+coords transiently to decide teleport on the NEXT click; never store a stream).
       - wheel → set has_wheel=true, wheel_count++.
       - mousedown/mouseup → accumulate click_duration (ms) into a running mean/std accumulator (Welford or sum/sumsq); click → click_count++, and if no qualifying mousemove occurred in ~500ms / ~100px before it, increment a teleport counter.
       - pointermove → pointer_move_count++.
       - keydown → keydown_count++ ONLY. NEVER read event.key / event.code / per-key timing (PRIV-04, the biometric tripwire).
       - NEVER store coordinate streams or key values (PRIV-01).
    3. On `pagehide` OR `visibilitychange` to hidden (whichever fires first; guard against double-send), OR a ~cap timeout (e.g. 180s per §04-detection-sota §7 L4 window): compute the ~10 aggregate features (mouse_event_rate = mousemove count / (session_ms/1000); teleport_click_ratio = teleport count / max(click_count,1); interaction_total = sum), call `scoreBehavior(features)`, and `navigator.sendBeacon('/api/v1/beh', JSON.stringify({features, score, band, path: location.pathname}))`. Use sendBeacon (keepalive) so it survives unload. Then discard all raw/transient data (PRIV-01).
    4. Send at most once per pageview.

    Match the existing file's ENABLED-gate / never-throw style (src/lib/analytics.js). Do NOT add any npm dependency. Do NOT store any cookie/localStorage/identifier for the beacon (PRIV-03) — the beacon is stateless per pageview.
  </action>
  <verify>
    <automated>npm run build</automated>
  </verify>
  <done>`npm run build` succeeds. BaseLayout.astro contains: the activate fetch (`fetch('/api/v1/beh/activate'`), the scoreBehavior import from ../lib/beh-score.js, keydown handler that increments a count only (no event.key/event.code access), and `navigator.sendBeacon('/api/v1/beh'`. Beacon is inside try/catch and attaches no listeners when activate is false.</done>
</task>

</tasks>

<verification>
- `node --test src/lib/beh-score.test.js` — all four band outcomes + biometric-line invariant pass.
- `node --test worker/beh.test.js` — EU/US activate, payload reject/clamp, EU POST dropped (no DB write), row carries no identifier.
- `npm test` — full suite green; count increases ONLY by the new beh-score + beh tests. The 2 known embed-skills failures are pre-existing and acceptable.
- `npm run check:patterns` — clean (no new data-file string reads introduced; beh.js touches env.DB only; BaseLayout reads no data files).
- `npm run build` — succeeds; client beacon bundles scoreBehavior.
- Grep glue verification (index.js can't be imported in Node tests — established constraint):
  - `grep -n "from './beh.js'" worker/index.js` → import present.
  - `grep -n "/api/v1/beh/activate\|'/api/v1/beh'" worker/index.js` → both routes present BEFORE the `env.ASSETS.fetch` fallthrough.
  - `grep -n "behavior_log" worker/schema.sql` → DDL present, and confirm NO `ip_hash` / identifier column in that block.

Privacy-invariant self-check (all must hold — any violation is a BLOCKER):
- [ ] behavior_log columns contain NO ip_hash, NO cookie/nonce, NO device identifier (PRIV-03).
- [ ] Only aggregate numbers + score + band + path are POSTed; no coordinates, no per-event sequences, no key identities leave the browser (PRIV-01).
- [ ] EU/EEA/UK: activate returns false → no listeners, no POST; and a POST reaching the worker is dropped (PRIV-02).
- [ ] keydown handler increments a count and NEVER reads event.key/event.code/per-key timing (PRIV-04).
</verification>

<success_criteria>
- Pure scorer, worker logic + routes, D1 table, and client beacon all implemented per the SETTLED design.
- All new unit tests pass; existing suite unaffected (except the 2 known embed-skills fails).
- check:patterns clean; build succeeds; grep-verified glue.
- Every hard privacy invariant (PRIV-01..04) verifiably held.
- Atomic conventional commits per task. DO NOT push — orchestrator reviews and does post-deploy verification (curl activate from non-EU vantage → activate:true; POST synthetic payload → behavior_log row; browser pageview with mouse movement → row lands; EU-simulated request → no beacon).
</success_criteria>

<deferred>
- Reporting/aggregation query over behavior_log (surfacing the beacon band alongside the log-based band) — FOLLOW-UP task, NOT part of this work. Do NOT wire any cron; the beacon feeds behavior_log continuously once deployed.
- Post-deploy calibration of scoreBehavior weights/thresholds against sessions the log-based band already flagged.
- Any ADD COLUMN migration of behavior_log (the lazy MISSING_COLUMN_RE path is present for future use but no new columns ship here).
</deferred>

<output>
After completion, create `.planning/quick/260905-fib-behavioral-beacon-client-side-structural/260905-fib-SUMMARY.md`
</output>
