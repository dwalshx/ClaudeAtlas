---
phase: quick-260804-d5p
verified: 2026-08-04T00:00:00Z
status: gaps_found
score: 5/6 must-haves verified
gaps:
  - truth: "The snapshot object carries totals{analyzed,indexed,tiers}, by_entity_type, by_category, new_last_7d, maintenance{active,abandoned}, unique_creators, churn{archived,duplicates}"
    status: partial
    reason: >
      The delivered aggregateSnapshot() emits a SIMPLER shape than the PLAN
      must_haves (and the verification contract) require. Four required data
      categories are entirely absent, and three field names diverge. The core
      composition counters (totals, tiers, entity-type breakdown, categories)
      are present and correct, but the growth / maintenance / creator / churn
      signals — the explicit "trend content" payload named in the PLAN
      objective ("growth, maintenance health, creator count, churn") — were
      never implemented.
    artifacts:
      - path: "scripts/snapshot-catalog.js"
        issue: >
          Returns { schema_version, date, generated_at, totals{records,indexed,
          duplicates,tiers}, by_entity_type, categories }. MISSING: new_last_7d,
          maintenance{active,abandoned}, unique_creators, churn{archived,...}.
          No reference to repo_pushed_at (90d maintenance window), scraped_at
          (7d growth), repo_archived (churn), or repo_full_name (creators)
          anywhere in the file. Field-name divergences: `records` (plan:
          `analyzed`), `categories` (plan: `by_category`), `generated_at`
          (plan: `timestamp`).
    missing:
      - "new_last_7d: count of records with scraped_at within last 7d (best-effort growth proxy)"
      - "maintenance{active,abandoned}: partition by repo_pushed_at vs 90d window (missing/unparseable → abandoned)"
      - "unique_creators: distinct repo_full_name owner count"
      - "churn.archived: count of repo_archived === true (churn.duplicates is present via totals.duplicates but not under a churn key)"
      - "(optional) reconcile field names analyzed/by_category/timestamp OR treat the delivered names as the accepted contract"
---

# Quick 260804-d5p: Versioned Catalog Composition Snapshot Verification Report

**Task Goal:** Add a versioned catalog-composition snapshot job (data/snapshots/YYYY-MM-DD.json) into the daily pipeline to power AEO trend content — purely additive, no scoring/filter/render changes.
**Verified:** 2026-08-04
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | Running `node scripts/snapshot-catalog.js` writes a well-formed single-object data/snapshots/<today>.json | ✓ VERIFIED | `buildAndWriteSnapshot()` (L231) resolves the three catalog files, calls `aggregateSnapshot`, writes via `writeJsonAtomic` (L190) using `openSync`/`writeSync`/`closeSync` + `renameWithRetry` (tmp+rename). mkdir-guarded (L192). SUMMARY documents a real dry run producing valid output. |
| 2 | Snapshot object carries the full documented field set (analyzed, tiers, by_entity_type, by_category, new_last_7d, maintenance, unique_creators, churn) | ✗ FAILED | `aggregateSnapshot` return (L156-163) omits new_last_7d, maintenance, unique_creators, churn.archived entirely. Grep for `new_last_7d\|maintenance\|unique_creators\|churn\|repo_pushed_at\|repo_archived\|scraped_at\|repo_full_name` → **no matches**. Field names also diverge (records/categories/generated_at). |
| 3 | aggregateSnapshot() is importable without side effects and returns correct counts on a mixed-entity fixture | ✓ VERIFIED | Invoked-as-script guard (L266-276) copied verbatim from filter.js. Import-safety test (L28) + sentinel-date check pass. 7/7 unit tests green. |
| 4 | `npm run check:patterns` reports clean (snapshot script allowlisted) | ✓ VERIFIED | `[check-banned-patterns] lint mode: clean (0 baselined, 0 new)`. Allowlist entry present (check-banned-patterns.js L167-170). |
| 5 | Daily workflow generates the snapshot after enrich and commits data/snapshots/<today>.json | ✓ VERIFIED | Step "Snapshot catalog composition" at L400, gated `github.event_name != 'push'` (L401), positioned after Enrich (L359/L386) and before Build (L566). `data/snapshots/` added to commit-back git-add (L639). |
| 6 | No scoring, filtering, or rendering source file is modified (purely additive) | ✓ VERIFIED | `git show --stat` of 49dd8e3/deed98e/040e18f/cd20f2f touches only snapshot-catalog.js, snapshot-catalog.test.js, check-banned-patterns.js (allowlist), daily-scrape.yml, and the SUMMARY. No score.js/filter.js/*.astro/src touched. |

**Score:** 5/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `scripts/snapshot-catalog.js` | pure aggregateSnapshot + main reader/writer | ⚠️ STUB (partial) | Exists, 276 lines, substantive and wired. But aggregation payload is incomplete vs contract (see Truth 2). Reader uses `readNdjsonRecords` (L43, L176) — no `readFileSync` on data/. Write is atomic tmp+rename. |
| `scripts/snapshot-catalog.test.js` | node:test coverage of aggregateSnapshot | ✓ VERIFIED | 7 tests, all pass. Covers import-safety, empty catalog, indexed-vs-tiers decision, entity partitioning, legacy robustness, category distribution, _header skip. (Note: no tests for the missing maintenance/growth/creator/churn logic — because that logic does not exist.) |
| `scripts/check-banned-patterns.js` | LINT_ALLOWLIST file-only entry | ✓ VERIFIED | Entry at L167-170, file-level, mirrors generate-feeds.js shape. |
| `.github/workflows/daily-scrape.yml` | snapshot step + commit-back | ✓ VERIFIED | Step L400-402; git-add L639. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| snapshot-catalog.js | lib/ndjson.js | `readNdjsonRecords` import | ✓ WIRED | Imported L43, used L176. No `readFileSync` utf-8 on data/. |
| daily-scrape.yml | snapshot-catalog.js | `node scripts/snapshot-catalog.js` after enrich | ✓ WIRED | L402, after enrich (L386) / before build (L566). |
| daily-scrape.yml | data/snapshots/ | git add in Commit step | ✓ WIRED | L639. |
| snapshot-catalog.js | category:<slug> tags | tag-prefix extraction | ✓ WIRED | L138-145 extracts `category:` slug from `rec.tags`, matches site derivation. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Unit tests pass | `node --test scripts/snapshot-catalog.test.js` | 7 pass, 0 fail | ✓ PASS |
| Lint clean | `npm run check:patterns` | clean (0 baselined, 0 new) | ✓ PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| snapshot-catalog.js | 196 | `JSON.stringify(obj, null, 2)` (Banned B) | ℹ️ Info | Allowlisted as bounded ~few-KB sidecar. Correct per plan. |

### Gaps Summary

The infrastructure of this task is fully and cleanly delivered: a new pure,
import-safe `aggregateSnapshot`, streaming NDJSON reads (no Banned-A), atomic
bounded write, lint allowlist, correctly-placed and correctly-gated daily-cron
step, and commit-back wiring — all purely additive with zero scoring/filter/
render changes. Tests (7/7) and the pattern lint both pass.

The gap is in the **snapshot payload content**. The PLAN's must_haves (truth 2)
and the verification contract both require the snapshot to carry `new_last_7d`
(growth), `maintenance{active,abandoned}` (repo_pushed_at 90d health),
`unique_creators`, and `churn{archived,duplicates}`. The delivered object
carries only `totals{records,indexed,duplicates,tiers}`, `by_entity_type`, and
`categories`. None of the growth/maintenance/creator/churn logic exists in the
file (no reference to `scraped_at`, `repo_pushed_at`, `repo_archived`, or
`repo_full_name`). Three field names also diverge from the spec
(`records`↔`analyzed`, `categories`↔`by_category`, `generated_at`↔`timestamp`).

The SUMMARY's "Deviations from Plan" note explains why: the executor reported
the `260804-d5p-PLAN.md` artifact was "not present in the worktree" at execution
time, so it built against a narrower set of "orchestrator constraints +
advisories." The PLAN file now exists on disk and specifies the fuller shape —
so the delivered artifact is a genuine under-delivery against its own plan and
against the stated AEO objective ("growth, maintenance health, creator count,
churn").

This is a content gap, not a wiring gap: the daily pipeline will faithfully
commit these snapshots, but they will be missing four of the trend signals the
feature was scoped to power. A follow-up plan should extend `aggregateSnapshot`
with the four missing aggregations (plus tests) and, ideally, reconcile the
field naming.

---

_Verified: 2026-08-04_
_Verifier: Claude (gsd-verifier)_
