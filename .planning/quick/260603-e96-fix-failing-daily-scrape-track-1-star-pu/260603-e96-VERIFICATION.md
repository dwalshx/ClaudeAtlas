---
phase: quick-260603-e96
verified: 2026-06-03T00:00:00Z
status: human_needed
score: 6/6 must-haves verified (automated); 1 production-scale validation deferred to human
re_verification:
  previous_status: none
human_verification:
  - test: "Production-scale branch-CI dispatch of daily-scrape.yml on branch fix/track1-rate-limit"
    expected: "Track 1 completes the full ~4,351-repo GraphQL sweep without 403/429 storms, failure ratio < 15%, run finishes well under the 330-min ceiling, and a data/history/<today>.json is written with the unchanged s/f/i/p schema and a plausible repo_count. Deploy/publish/upload steps stay gated to main (no production touch)."
    why_human: "The scraper cannot be exercised end-to-end locally (needs SCRAPE_PAT + real GitHub API + ~7 min at full scale). This is a documented post-execution step, NOT an automated gap — see PLAN <verification> 'Production validation'."
---

# Phase quick-260603-e96: Fix Failing Daily Scrape (Track 1 Star Pulse) Verification Report

**Phase Goal:** Fix the failing daily scrape — Track 1 was tripping GitHub's secondary (abuse) rate limit at the ~4,351-repo corpus, failing scheduled runs and dropping the unreplayable daily-history snapshot. Two-part fix: (A) retry-after-aware backoff + ~100ms inter-request delay + MAX_FAIL_RATIO 0.10→0.15; (B) migrate Track 1 to batched GraphQL.
**Verified:** 2026-06-03
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth   | Status     | Evidence       |
| --- | ------- | ---------- | -------------- |
| 1   | On a secondary 403/429, fetcher honors `retry-after` before primary reset / blind-60s | ✓ VERIFIED | github-fetch.js: `rateLimitedFetch` reads `retry-after` at L100-108 BEFORE `x-ratelimit-reset` (L109) and blind-60s (L118); `fetchWithETag` reads it at L211-219 BEFORE reset (L220) and blind-60s (L228). Both cap at 120s + 1s jitter. |
| 2   | Track 1 refreshes ~4,351 repos via batched GraphQL (~88 queries) not serial REST | ✓ VERIFIED | scrape-pulse.js L127-140 chunks `repoList` in `BATCH_SIZE=50` slices calling `fetchRepoBatchGraphql`; old REST `refreshRepo` loop removed. github-graphql.js `buildPulseQuery` builds aliased `r0..rN` blocks. |
| 3   | Null GraphQL alias (deleted/renamed/private) tolerated as casualty, not whole-query failure | ✓ VERIFIED | github-graphql.js L211-219: `node == null` → push to `failures` (`graphql-null`); non-empty `errors[]` explicitly NOT treated as failure (L209-210); only transport non-200 / missing `data` fail the batch. Test 7 guards the per-alias resolution. |
| 4   | repo_open_issues stays REST-equivalent (open issues + open PRs) — no scorer drift | ✓ VERIFIED | github-graphql.js L42: `(node.issues?.totalCount \|\| 0) + (node.pullRequests?.totalCount \|\| 0)`. Issues-only semantic explicitly DEFERRED in comment (L33-36). Test 2 asserts 7+3=10 AND `notEqual 7` (anti-regression). |
| 5   | Daily-history snapshot schema unchanged (s/f/i/p + date/timestamp/repo_count), same-day numbers | ✓ VERIFIED | scrape-pulse.js `writeHistorySnapshot` L63-95 untouched: short keys s/f/i/p (L80-83), date/timestamp/repo_count (L88-91), archived+fork exclusion (L78). Apply-in-place loop L158-167 iterates `TRACK1_FRESHNESS_FIELDS` unchanged. No time-gating. |
| 6   | Track 1 keeps authenticating with SCRAPE_PAT (5,000 GraphQL pts/hr), never Actions token | ✓ VERIFIED | github-graphql.js L139 reads `process.env.GITHUB_TOKEN` (= SCRAPE_PAT in CI per comment L117-119); `Bearer ${token}` at L146. Workflow YAML unchanged (sets GITHUB_TOKEN to SCRAPE_PAT). |

**Score:** 6/6 truths verified (automated). 1 item (production-scale sweep) deferred to human verification by design.

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `scripts/lib/github-fetch.js` | retry-after-aware backoff in both fetch fns | ✓ VERIFIED | `retry-after` honored first in both `rateLimitedFetch` and `fetchWithETag`. node --check clean. |
| `scripts/lib/github-graphql.js` | batch client + pure mapping (open issues + PRs) | ✓ VERIFIED | Exports `fetchRepoBatchGraphql`, `mapGraphqlRepoToFields`, `buildPulseQuery`. node --check clean. |
| `scripts/scrape-pulse.js` | GraphQL-batched loop, MAX_FAIL_RATIO 0.15 | ✓ VERIFIED | `BATCH_SIZE=50`, `BATCH_DELAY_MS=100`, imports + calls `fetchRepoBatchGraphql`; `MAX_FAIL_RATIO: 0.15` (L45). node --check clean. |
| `scripts/lib/__tests__/github-graphql.test.js` | unit tests, token-free + network-free | ✓ VERIFIED | 7 tests pass with GITHUB_TOKEN unset; imports only github-graphql.js + skill-fields.js, NOT github-fetch.js. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| scrape-pulse.js | github-graphql.js | `import { fetchRepoBatchGraphql }` + batched loop | ✓ WIRED | L28 import; L130-131 call inside the chunked loop. |
| github-graphql.js | TRACK1_FRESHNESS_FIELDS shape | mapping emits exactly 11 keys | ✓ WIRED | Test 1 asserts key-set equality against `TRACK1_FRESHNESS_FIELDS`; passes. |
| scrape-pulse.js writeHistorySnapshot | data/history/YYYY-MM-DD.json | unchanged s/f/i/p from refreshed fields | ✓ WIRED | L79-84 emits s/f/i/p sourced from `skill.repo_stars/forks/open_issues/pushed_at` (refreshed in-place). |

### Locked-Decision Compliance (explicit checks requested)

| # | Locked decision | Status | Evidence |
| - | --------------- | ------ | -------- |
| 1 | Stopgap targets secondary limit; retry-after BEFORE x-ratelimit-reset/blind in both fns; pulse delay + MAX_FAIL_RATIO=0.15 | ✓ PASS | Both fetch fns ordered retry-after → reset → blind. Inter-batch delay `BATCH_DELAY_MS=100` (the GraphQL loop superseded the per-request PULSE_DELAY per plan Task 2). MAX_FAIL_RATIO=0.15. |
| 2 | REST parity open-issues = issues(OPEN)+PRs(OPEN), no scorer drift; issues-only DEFERRED via comment; regression test guards it | ✓ PASS | L42 sums both; L33-36 comment defers issues-only; Test 2 guards (`notEqual 7`). |
| 3 | Snapshot contract unchanged; short keys + apply-in-place untouched; only data SOURCE changed; no time-gating | ✓ PASS | writeHistorySnapshot + apply loop verbatim; only the refresh loop's data source changed REST→GraphQL. |
| 4 | github-graphql.js ZERO import from github-fetch.js (local sleep); test runs token-free, imports no token-dependent module | ✓ PASS | No `import ... github-fetch` anywhere (only comments). Local `sleep` at L24. Token-free import probe + 7 token-free tests pass. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| 3 source files parse | `node --check` ×3 | all OK | ✓ PASS |
| Unit tests pass token-free | `node --test ...github-graphql.test.js` (GITHUB_TOKEN unset) | 7 pass / 0 fail | ✓ PASS |
| Footguns clean | `npm run check:patterns` | `lint mode: clean (0 baselined, 0 new)` | ✓ PASS |
| Token-free module import | `import('./github-graphql.js')` with GITHUB_TOKEN unset | resolves; buildPulseQuery works | ✓ PASS |
| Full ~4,351-repo GraphQL sweep | branch-CI dispatch of daily-scrape.yml | not run (needs PAT+API+~7min) | ? SKIP → human |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| E96-STOPGAP | 01 | retry-after backoff + delay + fail-ratio bump | ✓ SATISFIED | Truth 1 + Locked-decision 1 |
| E96-GRAPHQL | 01 | GraphQL batch migration | ✓ SATISFIED | Truths 2, 3, 6 |
| E96-PARITY | 01 | open-issues REST parity, no scorer drift | ✓ SATISFIED | Truth 4 + Locked-decision 2 |
| E96-SNAPSHOT | 01 | history snapshot schema preserved | ✓ SATISFIED | Truth 5 + Locked-decision 3 |

### Anti-Patterns Found

None blocking. The scrape-pulse.js module-header docstring still lists `data/etag-cache.json` as an input (L17) and "~826 requests today" (L19), both now stale post-GraphQL-migration — informational only, no functional impact.

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| scripts/scrape-pulse.js | 17-19 | Stale docstring (etag-cache input, request count) | ℹ️ Info | Doc-only; no behavioral effect |

### Human Verification Required

1. **Production-scale branch-CI dispatch** — Dispatch `daily-scrape.yml` on branch `fix/track1-rate-limit`.
   - Expected: Track 1 completes the full ~4,351-repo GraphQL sweep with no 403/429 storms, failure ratio < 15%, run well under 330 min, and a same-day `data/history/<today>.json` with the unchanged s/f/i/p schema + plausible repo_count. Deploy/publish/upload stay gated to main.
   - Why human: scraper cannot run end-to-end locally (SCRAPE_PAT + real API + ~7 min). Documented post-execution step in PLAN `<verification>`, NOT an automated gap.

### Gaps Summary

No automated gaps. All 6 observable truths VERIFIED, all 4 artifacts pass levels 1-3 (exist, substantive, wired), all 3 key links WIRED, all 4 LOCKED decisions hold, all 4 requirements SATISFIED, and all automated checks (node --check ×3, token-free unit tests, check:patterns, token-free import probe) pass. The single outstanding item — the production-scale branch-CI dispatch — is the documented true production validation that cannot run locally, correctly classified as human verification rather than a gap.

---

_Verified: 2026-06-03_
_Verifier: Claude (gsd-verifier)_
