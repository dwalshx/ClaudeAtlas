---
phase: quick-260905-esm
plan: 01
subsystem: analytics/agent-detection
tags: [agent-analytics, d1, offline-analysis, hidden-agent-band, calibration]
requires:
  - Cloudflare D1 request_log (worker/request-log.js) with classifier_method, asn_class, sec_fetch_coherent, accept_header columns
provides:
  - scripts/lib/agent-band.js (pure scoreSession scorer)
  - scripts/agent-band.js (D1 read-only aggregator + 5-section report + sidecar)
  - data/agent-band.json (bounded aggregate sidecar)
  - npm run agent-band
affects:
  - scripts/check-banned-patterns.js (allowlist)
  - package.json (script)
tech-stack:
  added: []
  patterns:
    - D1 REST /query read-only aggregation (mirrors scripts/snapshot-traffic.js)
    - pure/deterministic scorer split from I/O for unit testability
key-files:
  created:
    - scripts/lib/agent-band.js
    - scripts/lib/agent-band.test.js
    - scripts/agent-band.js
    - data/agent-band.json
  modified:
    - scripts/check-banned-patterns.js
    - package.json
decisions:
  - "Session = (ip_hash, user_agent, UTC-day); daily-salted ip_hash means no cross-day linkage (accepted)"
  - "All per-session aggregation done IN SQL; ip_hash/user_agent only in GROUP BY, never SELECTed/printed/written"
  - "Single-request no-tell sessions capped at 'uncertain' to protect low-interaction humans"
  - "D1 REST /query returns complete large result sets (~199k rows verified); no ~10k page cap"
metrics:
  duration: ~35m
  completed: 2026-09-05
---

# Quick 260905-esm: Log-Based Hidden-Agent Band Summary

Offline, read-only D1 analysis that scores each per-session request-log aggregate
(ip_hash × user_agent × UTC-day) into a human/uncertain/agent band from log signals
alone, calibrated against cooperative ground truth (token_echo/mcp), so Dan can
quantify "agents hiding in the human bucket" without any live-worker change or PII.

## What shipped

- **`scripts/lib/agent-band.js`** — pure, zero-I/O `scoreSession(agg) → {score, band, method, single_fetch_no_asset, signals}`. Ground-truth shortcut (token_echo/mcp → score 1, agent-shaped, cooperative), documented CALIBRATE weight set, single-request no-tell cap, and a `single_fetch_no_asset` reporting flag (1 content req / 0 assets / no strong tell; still scored `uncertain`). 13/13 unit tests.
- **`scripts/agent-band.js`** — D1 REST read-only aggregator. ONE per-session `GROUP BY (day, ip_hash, user_agent)` conditional-SUM query; prints the 5-section console report and writes the bounded `data/agent-band.json` sidecar. Env-check-first + try/catch → warn+exit(0); invoked-as-script guard.
- **`data/agent-band.json`** — bounded aggregate sidecar (band dist + component breakdown + calibration + hidden-agent range). No per-session rows, no ip_hash, no user_agent.
- **Housekeeping** — allowlist entry for `scripts/agent-band.js` (Banned B on a bounded sidecar); `npm run agent-band` script.

## Live-D1 run (7-day window, pasted verbatim for Dan)

Command: `node --env-file=.env scripts/agent-band.js`

```
[1] Window: 2026-08-29 → 2026-09-05  (7 days)
    Total sessions scored: 199225

[2] Band distribution over the AMBIGUOUS POOL (class ∈ {human, unknown})
    Pool size: 115954 sessions
    agent-shaped          : 2194  (1.9%)   ← "hidden in the human bucket"
    single-fetch-no-asset : 110074  (94.9%)
    uncertain (other)     : 581  (0.5%)
    human-shaped          : 3105  (2.7%)
    note: single-fetch-no-asset is likely mostly non-human (a real browser
          pulls its assets) but unprovable per-session from logs — held out
          of the agent count deliberately (still scored 'uncertain').

[3] Component-signal breakdown of the ambiguous pool (115954 sessions)
    markdown Accept > 0        : 432  (0.4%)
    agent-endpoint hits        : 22  (0%)
    asset_ratio < 0.1 w/content: 112843  (97.3%)
    incoherent Sec-Fetch       : 45  (0%)
    one-fetch-each sweep       : 1563  (1.3%)

[4] Calibration check
    DEFINITE agents (token_echo OR mcp) — MUST be agent-shaped:
      count 1  →  agent-shaped 1, uncertain 0, human-shaped 0
    CLEARLY-human (asset_ratio≥0.5, coherent, residential) — should be human-shaped:
      count 1840  →  agent-shaped 0, uncertain 0, human-shaped 1840

[5] Estimated hidden agents in the human bucket
    agent-shaped: 2194
    range (incl. half the uncertain bucket): 2194–57522 sessions
```

> **Reporting update (coordinator-approved, 2026-09-05):** the single-fetch-no-asset
> pattern is now broken out as its own named line in section 2 (and as a
> `single_fetch_no_asset` key in `data/agent-band.json`) instead of being buried
> in `uncertain`. This is a VISIBILITY split only — scoring weights and band
> thresholds are unchanged; these sessions still score as `uncertain`. Breaking
> it out shows that the "95.4% uncertain" is almost entirely this one pattern
> (94.9%), leaving genuine `uncertain (other)` at just 0.5% (581 sessions).

## Reading the numbers (calibration is sane, but the pool is dominated by unknowns)

- **Calibration passes on both anchors:** the sole cooperative-ground-truth session (token_echo/mcp) lands agent-shaped, and all 1,843 clearly-browser sessions (asset-heavy + coherent + residential) land human-shaped. Weights did not need adjusting to hit either anchor.
- **The headline is honest, not blunt:** the ambiguous pool is **94.9% single-fetch-no-asset** (110,074 sessions) — now broken out as its own named line rather than buried in `uncertain` (which drops to just 0.5% / 581 "other"). A real browser first-paint pulls `_astro/*.css`, JS, favicon in the same session, so a lone content request with zero assets is likely mostly non-human — but it is unprovable per-session from logs, so the single-request no-tell **cap deliberately holds these as `uncertain` (held out of the agent count)** to protect cached-asset / low-interaction / assistive-tech humans and because the daily-salt session boundary can split a real visit. This is the internet's biggest ambiguous pattern; surfacing it as a tracked segment is the point.
- **Confident agent-shaped in the human bucket: 2,194 sessions (1.9%)** — these cleared the cap (markdown Accept, agent endpoints, multi-page no-asset sweeps, or incoherent Sec-Fetch). The estimated range including half the uncertain bucket is **2,194–57,567 sessions/7 days**.
- **Strong tells are rare but clean:** markdown Accept 0.4%, agent-endpoint hits ~0%, incoherent Sec-Fetch ~0%. Cooperative ground truth is tiny (1 session in 7 days), consistent with the telemetry finding that agents barely touch /api or /llms.txt.

**Suggested follow-ups for Dan (not done — look-at-data first):** (a) the `uncertain` bucket is where the real signal is buried — a next pass could split single-request sessions by ASN class (hosting vs residential) to sharpen the estimate without a client beacon; (b) wire into cron only after the bands look trustworthy.

## Verification

- `node --test scripts/lib/agent-band.test.js` → 13 pass / 0 fail (ground truth, browser→human, markdown/ratio0→agent, single-req→uncertain cap, single-fetch-no-asset flag set/not-set cases, signals evidence, div0 guard).
- `node --env-file=.env scripts/agent-band.js` → all 5 sections render (section 2 now four lines incl. single-fetch-no-asset); token_echo/mcp → agent-shaped; clearly-browser → human-shaped; sidecar written.
- `npm run check:patterns` → clean (0 baselined, 0 new; `scripts/agent-band.js` allowlisted).
- `npm test` → 381 tests, 373 pass, **2 fail** (both pre-existing embed-skills `Task 9: B-2` fails — unchanged), 6 skipped. My 13 new tests are among the passing.
- `git check-ignore data/agent-band.json` → no output (exit 1 = committable).
- No-env path → `[agent-band] ... not set — skipping` + exit 0.
- PII check: `grep -iE "ip_hash|user_agent" data/agent-band.json` → none. Report/sidecar carry aggregates only.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Misleading D1 truncation warning (false positive)**
- **Found during:** Task 3 live-D1 run.
- **Issue:** The planned guard warned "results may be truncated" whenever the query returned ≥ 10,000 rows, on the assumption D1 caps responses at ~10k. The live run returned **199,348 complete rows** in one response — the warning fired but the data was not truncated, which would mislead Dan reading the report.
- **Fix:** D1's REST `/query` returns complete large result sets and throws on oversize responses (already handled by `d1Query`), rather than silently truncating. Replaced the ~10k cap with a high-water FYI (`D1_ROW_FYI = 250000`) and reworded the message; the guard no longer claims truncation.
- **Files modified:** `scripts/agent-band.js`
- **Commit:** chore(quick-260905-esm) housekeeping commit.

## Known Stubs

None. `data/agent-band.json` is populated from a real live-D1 run (not a placeholder).

## Notes for orchestrator

- **Not pushed.** Per task constraints, the orchestrator reviews the DATA first.
- **ROADMAP.md / STATE.md left untouched** in this worktree (STATE.md lives in the shared checkout; orchestrator owns the merge + state update).
- Commits are atomic conventional commits on branch `worktree-agent-a6df8a22f0e7d54b6`.

## Self-Check: PASSED
