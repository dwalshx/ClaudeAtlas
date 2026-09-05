---
phase: quick-260905-fib
plan: 01
subsystem: agent-analytics
tags: [behavioral-beacon, privacy, d1, worker, client-instrumentation, automation-detection]
requires:
  - worker/index.js route wiring
  - worker/request-log.js lazy-migration pattern (mirrored, not imported)
  - src/layouts/BaseLayout.astro client-script slot
provides:
  - src/lib/beh-score.js (pure scoreBehavior)
  - worker/beh.js (geo-gate + identifier-free ingest + routes)
  - behavior_log D1 table (lazy-created)
  - client behavioral beacon
affects:
  - worker/index.js (two additive routes)
  - worker/schema.sql (behavior_log DDL, source of truth)
  - package.json (test glob extended to src/lib)
tech-stack:
  added: []
  patterns:
    - pure-module (asn-class.js shape) for scoreBehavior + beh geo/validate logic
    - lazy CREATE-on-"no such table" via Worker DB binding (request-log.js pattern)
    - ctx.waitUntil non-blocking D1 insert
    - navigator.sendBeacon fire-and-forget client egress
    - Astro bundled module <script> (import resolved + inlined into HTML)
key-files:
  created:
    - src/lib/beh-score.js
    - src/lib/beh-score.test.js
    - worker/beh.js
    - worker/beh.test.js
  modified:
    - worker/index.js
    - worker/schema.sql
    - src/layouts/BaseLayout.astro
    - package.json
decisions:
  - "Interaction-volume gate runs FIRST in scoreBehavior — near-zero / assistive-tech / keyboard-only sessions are always 'uncertain', never 'automation-signature' (missing signal must never become evidence-of-automation)."
  - "decideActivate defaults ON when BEH_BEACON_ENABLED is unset; only the exact string 'false' disables — ships with no wrangler/secret change."
  - "validateBehPayload returns a row keyed by EXACTLY BEHAVIOR_LOG_COLUMNS with timestamp+country as server-filled null placeholders — makes the identifier-free contract assertable."
  - "handleBehIngest always returns a uniform fast 204 (valid/invalid/DB-less) since sendBeacon never reads the body."
metrics:
  tasks: 3
  files_created: 4
  files_modified: 4
  tests_added: 34
  duration_min: 40
  completed: 2026-09-05
---

# Phase quick-260905-fib Plan 01: Behavioral Beacon (client-side structural automation signal) Summary

JS-executing agentic browsers (ChatGPT Atlas, Claude-in-Chrome, Perplexity Comet) run real Chrome from residential IPs, so the log-based band (`request_log`) cannot see them — but their **input-event structure** betrays automation. This plan ships the L4 behavioral beacon: a client instrument that captures ~10 STRUCTURAL interaction aggregates in the browser, scores an automation band IN THE BROWSER, and POSTs only those numbers + score + band to an identifier-free D1 table. It complements (does not replace) the log-based band, and honors four hard privacy invariants.

## What was built

1. **`src/lib/beh-score.js`** — pure ESM `scoreBehavior(features) → {score, band, signals}`. Zero I/O, zero imports, never throws (missing/NaN → 0/false, score clamped 0..1). Importable by the client bundle AND `node --test`. Weighted 5-component score (low-mouse-rate-with-clicks, wheel-absence-with-interaction, high-teleport-ratio, low-pointer-move, low-click-duration-spread), with an interaction-volume gate FIRST so near-zero/assistive-tech sessions are `uncertain`. Starting weights/thresholds documented as post-deploy-calibratable.
2. **`worker/beh.js`** — pure geo/ingest logic + thin handlers, mirroring `asn-class.js` (pure exports) and `request-log.js` (lazy migration + waitUntil insert): `EU_EEA_UK` (31), `isEuCountry`, `decideActivate`, `validateBehPayload`, `handleBehActivate`, `handleBehIngest`, `BEHAVIOR_LOG_DDL`, `BEHAVIOR_LOG_COLUMNS`. Lazy CREATE-on-"no such table" via the Worker's own DB binding; `MISSING_COLUMN_RE` kept intact for any future ADD COLUMN path.
3. **`worker/index.js`** — two additive routes (`GET /api/v1/beh/activate`, `POST /api/v1/beh`) before the `env.ASSETS` fallthrough; existing OPTIONS preflight (`startsWith('/api/')`) already covers them.
4. **`worker/schema.sql`** — identifier-free `behavior_log` DDL as source of truth, with the win32-arm64 lazy-create operator note.
5. **`src/layouts/BaseLayout.astro`** — bundled module `<script>` (import resolved + inlined into built HTML) implementing the activate-gated, passive-listener, sendBeacon-egress beacon inside one top-level try/catch.
6. **`package.json`** — test glob extended to `src/lib/**/*.test.js` (additive).

## Privacy invariant confirmation (spot-audit references)

**PRIV-01 — only aggregate numbers + score + band POSTed; raw discarded.**
- `worker/beh.js:208` — `validateBehPayload` builds `row` from a fixed whitelist; keys === `BEHAVIOR_LOG_COLUMNS` (`worker/beh.js:76`). No raw stream/coordinate/key can enter the row.
- `src/layouts/BaseLayout.astro:242-243` — transient teleport/duration state discarded after the single send; only computed aggregates are serialized (`BaseLayout.astro:216-227`).
- Test: `worker/beh.test.js` "row has EXACTLY the behavior_log columns".

**PRIV-02 — EU/EEA/UK never instrumented (three enforcement points).**
- Client activate-gate BEFORE any listener: `src/layouts/BaseLayout.astro:317-320` (`fetch('/api/v1/beh/activate')` → `attachListeners()` only when `activate === true`).
- Activate decision drops EU: `worker/beh.js:61` (`decideActivate` → `{activate:false}` for `isEuCountry`).
- Per-country response never cached: `worker/beh.js:255` (`cache-control: no-store`).
- POST-endpoint defense-in-depth re-drop: `worker/beh.js:324` (`if (isEuCountry(country))` → 204, no DB write).
- Tests: `worker/beh.test.js` "EU → {activate:false}, no-store" and "EU POST is DROPPED — no DB write".

**PRIV-03 — no device identifier anywhere (no ip_hash, cookie, nonce).**
- `worker/beh.js:76` — `BEHAVIOR_LOG_COLUMNS` has no identifier column.
- `worker/schema.sql:140` — `behavior_log` DDL explicitly carries no ip_hash/cookie/nonce/identifier column.
- Client is stateless per pageview — no cookie/localStorage written anywhere in the beacon.
- Tests: `worker/beh.test.js` "row carries NO identifier" + "DDL ... NO identifier".

**PRIV-04 — keydown COUNT only, never key identities or per-key timing.**
- Client: `src/layouts/BaseLayout.astro:299` — handler is `keydownCount++` only; comment at `:296` documents that `event.key`/`event.code`/timing are never read. Verified in BUILT output: grep of the inlined module found no `.key`/`.code` access.
- Validator: `worker/beh.js:218` — `keydown_count` treated as a plain clamped count.
- Scorer: `src/lib/beh-score.js:84` — `keydown_count` consumed as a scalar; no per-key field exists.
- Test: `src/lib/beh-score.test.js` "output is stable/defined for count-only keydown input".

## Verification results

- `node --test src/lib/beh-score.test.js` → 9/9 pass (four band outcomes incl. assistive-tech `uncertain`, biometric line, robustness).
- `node --test worker/beh.test.js` → 25/25 pass (EU/US activate, payload reject/clamp/oversize, EU POST dropped no-write, lazy-create retry, no identifier).
- `npm test` → 419 tests, 411 pass, **2 fail (pre-existing known embed-skills B-2 cache/drift tests)**, 6 skipped. Suite count rose only by the 34 new beh tests.
- `npm run check:patterns` → clean (0 baselined, 0 new).
- `npm run build`: full `npm run build` cannot complete in this worktree because `data/skills.ndjson` is absent (pre-existing worktree data gap, unrelated to this change) and the ~94-min O(n²) prebuild is impractical here. Verified instead by copying `data/skills.ndjson` from the main checkout and running `npx astro build` directly (sidecars already present): **build completed, 15,192 pages, 139s**. The beacon bundled correctly — the inlined `<script type="module">` in `dist/index.html` contains the resolved scorer (all three band strings present), no bare `import`, the `/api/v1/beh/activate` fetch, 9 passive listeners, and **no `.key`/`.code` access**. Copied data + `dist/` removed and prebuild-regenerated committed files reverted afterward, so only `src/layouts/BaseLayout.astro` was committed for Task 3.
- Grep glue: `worker/index.js` imports `from './beh.js'` and routes both paths before the ASSETS fallthrough; `worker/schema.sql` has the `behavior_log` DDL with no identifier column.

## Deviations from Plan

None — plan executed as written. The only notable execution detail is the build-verification method (astro-build-with-copied-data instead of full `npm run build`) forced by the worktree's pre-existing missing `data/skills.ndjson`; this is a worktree data-availability condition, not a code deviation. The beacon was verified end-to-end in the built HTML.

## Known Stubs

None. All modules are fully wired: the scorer feeds the client beacon, the beacon POSTs to the worker route, the worker validates + inserts into a lazily-created D1 table. The starting scorer weights/thresholds are intentionally conservative and flagged for post-deploy calibration (documented in `beh-score.js`), which is the plan's explicit deferred follow-up — not a stub.

## Deferred (per plan)

- Reporting/aggregation query over `behavior_log` (surface beacon band alongside the log-based band) — no cron wired.
- Post-deploy calibration of `scoreBehavior` weights/thresholds against sessions the log-based band already flagged.
- Any future `behavior_log` ADD COLUMN migration (the `MISSING_COLUMN_RE` path is present but unused today).

## Orchestrator post-deploy verification (from the plan)

- `curl` `/api/v1/beh/activate` from a non-EU vantage → `{activate:true}`; confirm `cache-control: no-store`.
- POST a synthetic payload → one `behavior_log` row lands (identifier-free).
- Real browser pageview with mouse movement → a row lands.
- EU-simulated request → activate `false`, and a forced POST is dropped (no row).

## Commits

- `b8783ea` feat(quick-260905-fib): pure structural behavioral scorer + tests (BEH-01)
- `caaa2f8` feat(quick-260905-fib): worker geo-gate + identifier-free beh ingest + routes (BEH-02/03/04)
- `20996fd` feat(quick-260905-fib): client behavioral beacon in BaseLayout (BEH-02, PRIV-01..04)

## Self-Check: PASSED

All 4 created files + 4 modified files present on disk; all 3 task commits (b8783ea, caaa2f8, 20996fd) present in git log.
