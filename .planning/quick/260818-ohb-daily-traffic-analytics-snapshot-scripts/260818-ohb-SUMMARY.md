---
phase: quick-260818-ohb
plan: 01
subsystem: analytics-pipeline
tags: [d1, traffic-analytics, snapshot, cron, aeo]
requires:
  - Cloudflare D1 request_log table (quick-260806-dn3 E1 + 260812-p3b L1)
  - CF_ACCOUNT_ID / CF_API_TOKEN (D1 read)
provides:
  - scripts/snapshot-traffic.js (D1 → per-day traffic time series)
  - data/traffic-snapshot.json (committed 13-day backfill)
  - daily-scrape.yml "Snapshot traffic analytics" cron step
affects:
  - .github/workflows/daily-scrape.yml
  - scripts/check-banned-patterns.js
tech-stack:
  added: []
  patterns: [d1-rest-query, bounded-sidecar-snapshot, exit-0-on-any-failure, atomic-tmp-rename]
key-files:
  created:
    - scripts/snapshot-traffic.js
    - data/traffic-snapshot.json
  modified:
    - .github/workflows/daily-scrape.yml
    - scripts/check-banned-patterns.js
decisions:
  - "Recompute all days every run (no rolling window) — fine at <1M request_log rows; documented future optimization in-script"
  - "classifier_version derived per-day from the 2026-08-12 v0→v1 cutover: v0 / mixed (cutover day) / v1"
  - "Any failure (missing creds, D1 error, zero rows) warns + exit 0, leaves existing snapshot untouched — never breaks the cron"
metrics:
  duration: ~15m
  completed: 2026-08-19
requirements: [OHB-01, OHB-02, OHB-03]
---

# Phase quick-260818-ohb: Daily Traffic-Analytics Snapshot Summary

Read-only D1 `request_log` aggregator that rolls the per-request log into a small
committed per-day time series (`data/traffic-snapshot.json`), wired into the daily
cron after enrichment and backfilled with 13 days of real history (2026-08-07 →
2026-08-19).

## What was built

- **`scripts/snapshot-traffic.js`** — Node 22 ESM, global `fetch`, no wrangler
  import. Reuses the D1 REST `d1Query` helper + `DATABASE_ID` verbatim from
  `apply-d1-schema.js`. Runs 5 aggregate `SELECT ... GROUP BY COUNT(*)` queries
  (class-by-day, coherent_datacenter, impersonation-by-operator, verified
  signers, scanner-probe 404s) — never selects `ip_hash` or any raw identifier.
  Exports the pure, unit-testable `buildDayRows(queryResults)` and
  `classifierVersionFor(date)`. Fully guarded: env-check first, and any
  failure → `console.warn('[snapshot-traffic] …')` + `process.exit(0)` with the
  existing file untouched (never throws, never non-zero, never logs the token).
  Atomic tmp+rename write.
- **`.github/workflows/daily-scrape.yml`** — new `Snapshot traffic analytics`
  step immediately after `Snapshot catalog composition`, non-push-gated
  (`if: github.event_name != 'push'`), `continue-on-error: true`, with
  `CF_ACCOUNT_ID` / `CF_API_TOKEN` in `env:`. `data/traffic-snapshot.json`
  appended to the main-only `Commit skills data` `git add` list.
- **`scripts/check-banned-patterns.js`** — whole-file `LINT_ALLOWLIST` entry for
  `scripts/snapshot-traffic.js` (bounded per-day D1 aggregate sidecar; the
  `JSON.stringify(obj, null, 2)` tmp-write is Banned-B on a bounded file).
- **`.gitignore`** — no change needed. `git check-ignore data/traffic-snapshot.json`
  exits non-zero (not matched by any ignore rule), so the sidecar is committable
  without a negation, same as `pipeline-stats.json` / `data/snapshots/`.

## Row shape (per day)

`{ date, classifier_version, total, class{6 keys}, coherent_datacenter,
human_corrected{v1_human, would_be_human_v0}, agents{genuine, impersonation,
ratio}, impersonation_by_operator{}, verified_signers{}, probes }`, wrapped in
`{ generated_at, cutover: '2026-08-12', days: [...] }` sorted ascending by date.

## Verification (Task 3 — live D1 run against production)

Command: `node --env-file=.env scripts/snapshot-traffic.js` →
`[snapshot-traffic] wrote data\traffic-snapshot.json: 13 days (2026-08-07 → 2026-08-19).`

Per-day summary from the committed file:

```
date        ver   total  human  agent imp   coherent_dc probes topImp          ahrefs  ratio
2026-08-07  v0    40107  11973  119   0     0           595    -               422     0
2026-08-08  v0    71175  28228  15    0     0           364    -               535     0
2026-08-09  v0    42714  9452   26    0     0           335    -               596     0
2026-08-10  v0    44047  6921   92    0     0           836    -               673     0
2026-08-11  v0    48889  5377   11    0     0           385    -               1181    0
2026-08-12  mixed 96254  6043   61    0     0           327    -               2442    0
2026-08-13  v1    84235  918    13    190   23479       191    bytedance:187   2121    14.6
2026-08-14  v1    34502  1534   14    557   12260       673    amazon:314      698     39.8
2026-08-15  v1    91349  9754   10    917   27406       524    bytedance:372   560     91.7
2026-08-16  v1    55836  1999   17    546   23416       1066   bytedance:377   456     32.1
2026-08-17  v1    55327  557    18    447   25296       504    bytedance:445   1017    24.8
2026-08-18  v1    90473  660    10    705   29974       729    bytedance:535   22355   70.5
2026-08-19  v1    2772   14     0     117   858         3      bytedance:117   617     null
```

Confirmed against plan checkpoints:
- 13 ascending rows spanning 2026-08-07 → 2026-08-19 (13 days; the run landed
  just past UTC midnight into the 19th, so 08-19 is a valid partial day — one
  more than the plan's ~11-12 estimate purely because a new UTC day had begun).
- Early days 2026-08-07..08-11 are `v0`; 2026-08-12 is `mixed`; all later days
  are `v1`.
- Recent v1 days (08-17, 08-18) show **bytedance leading** `impersonation_by_operator`
  (445, 535) and **ahrefs.com present** in `verified_signers` (1017, 22355).
- v0 days correctly carry `impersonation_suspected=0` / `coherent_datacenter=0`
  (the v0 classifier didn't emit those); the v1 `coherent_datacenter` bucket is
  the v0→v1 human-correction delta (`human_corrected.would_be_human_v0`).
- Every day has all six `class{}` keys and populated `human_corrected` / `agents`
  / `probes`.

Repo health:
- `npm run check:patterns` → `lint mode: clean (0 baselined, 0 new)`.
- `npm test` → 368 tests, **360 pass, 2 fail, 6 skipped**. The 2 failures are the
  known pre-existing embed-skills tests (`not ok 10/11 — Task 9: B-2 …`), count
  unchanged from baseline. No new failures.

## Deviations from Plan

None — plan executed exactly as written. The only nuance: the live run produced
13 days rather than the plan's ~11-12 estimate, because it executed just after
UTC midnight on 2026-08-19, adding a (partial) 08-19 row. This is expected
behavior of the "one row per UTC calendar day seen" logic, not a deviation.

## Notes for the orchestrator

- **Not pushed.** Three per-task commits + this docs commit are local to the
  worktree branch. The generated `data/traffic-snapshot.json` will refresh daily
  in the cron and re-commit on `main`.
- A temporary `.env` (copied from repo root for the live D1 run) was created in
  the worktree and **deleted** after Task 3; it is gitignored and was never
  committed. No secrets were printed.

## Self-Check: PASSED
