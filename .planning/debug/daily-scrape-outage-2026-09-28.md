---
status: root_cause_found
trigger: "daily-scrape.yml has failed every scheduled run since 2026-09-28 (last success 2026-09-26, run 36239648645). Site has not updated since. Two failure signatures seen: upload-vectors loads 0 records; Track 2 discovery returns HTTP 401."
created: 2026-11-05T20:40:00Z
updated: 2026-11-05T21:30:00Z
---

## Current Focus

hypothesis: CONFIRMED — four independent faults compounded into a 39-day silent outage. (1) The fine-grained `SCRAPE_PAT` expired on 2026-10-14/15 (set 2026-07-16, 90-day expiry); every REST discovery call returns 401 and every scraper treats 401 as "skip this page" instead of aborting. (2) The `Save skill-vectors cache` step runs `if: always()` even when the restore step was skipped, so the FIRST early failure (09-28, a GitHub GraphQL 502/504 storm) persisted the committed 1,078-vector Phase-1 seed as the newest cache key; every run since restores that seed and the embed drift guard correctly refuses to re-embed 103k records (exit 1). (3) The weekly full sweep (`scrape.js --mode=full`, 10-18) ran against the dead token, parsed 0 skills, WROTE the empty corpus before its own regression guard fired, and the `if: always()` cache save persisted the ~200-byte placeholder as the newest `skills-raw-ndjson-*` key; the daily restore-keys prefix match has picked that placeholder ever since. (4) `filter.js` and `embed-skills.js` accept zero-record inputs and emit zero-record outputs; only `upload-vectors.js` (step 30 of 40) refuses — far too late. The notify-on-failure job DID comment the open `cron-failure` issue (#18) every day (39 comments); nobody read it.
test: Timeline rebuilt from `gh run list` + per-run `gh run view --json jobs` + targeted `--log` greps; cache inventory via `gh cache list`; secret timestamps via `gh secret list`.
expecting: n/a (diagnosis complete)
next_action: Ship the fail-fast guards + runbook (PR); Dan rotates SCRAPE_PAT; run the reseed + force-reembed sequence in CLAUDE.md "Recovery: expired PAT / poisoned caches".

## Symptoms

expected: Daily cron (06:30 UTC) scrapes, filters, embeds, uploads, builds, deploys, commits `data/history/<today>.json` + `data/snapshots/<today>.json`.
actual: 39 consecutive scheduled failures 2026-09-28 → 2026-11-05. Last data commit on main: `cbae842 chore: update skills data 2026-09-26`. Release assets `skills-latest` / `plugins-latest` last updated 2026-09-27T18:00Z. GHA caches `skills-raw-ndjson-*` and `etag-cache-*` are ~200-byte placeholders; `skill-vectors-*` is the 5.8 MB committed seed.
errors: see timeline — three distinct first-failing steps across the window.
reproduction: `gh run list --workflow=daily-scrape.yml --limit 45`; `gh run view <id> --json jobs`.
started: 2026-09-27 (cancelled at Build, 360-min cap) / 2026-09-28 (first failure).

## Timeline (first failing step per scheduled run)

| Date (UTC)    | Run id       | First failing step              | Proximate cause (from log)                                                                                      |
|---------------|--------------|---------------------------------|-----------------------------------------------------------------------------------------------------------------|
| 09-23 → 09-26 | …36239648645 | — (success)                     | Last green run 2026-09-26.                                                                                       |
| 09-27         | 36318706548  | Build Astro site (cancelled)    | Hit `timeout-minutes: 360`. Caches saved earlier in the run were still good.                                     |
| 09-28         | 36435415654  | Run Track 1 (Star Pulse)        | GitHub GraphQL 502/504 storm: `failure ratio 21.2% > 15%` (2097/13667 repos). Classic PAT fine. **Side effect: `Save skill-vectors cache` ran (`if: always()`) with the restore step skipped → persisted the committed 1,078-vector seed as `skill-vectors-324`.** |
| 09-29 → 10-17 | 36573683211 … 39027348158 (19 runs) | Embed skills (OpenAI)  | Restored `skill-vectors-<prev>` = the seed. `prior-overlap: 6.86% (74/1078)` → `DRIFT DETECTED … Bailing out` (exit 1). Each run re-saves the seed, so the poison self-perpetuates. Track 2 still healthy through 10-14 (`Track 2 complete … total 145007`). |
| 10-15 (12:37) | 38731111370  | Embed skills (OpenAI)           | **First HTTP 401 from Track 2** (`WARN: HTTP 401 on topic=… skipping rest of topic` ×7, `unique candidate repos: 0`). 10-14 12:49 run was the last 200. `SCRAPE_PAT` was set 2026-07-16 → 90 days = 2026-10-14. Plugin code-search also 401 (`[search] HTTP 401, skipping`). Corpus still 145,007 (restored from cache, written back unchanged). |
| 10-18 (07:27) | weekly 39107698096 (#26) | Run Track 2 (Discovery, full) | `scrape.js --mode=full`: every search 401 → `Parsed 0 skills` → **wrote `data/skills-raw.ndjson` with 0 records (header only)** → regression guard exit 1 AFTER the write → `Save skills-raw cache` (`if: always()`) persisted the placeholder as `skills-raw-ndjson-26`. |
| 10-18 → 11-03 | 39123864824 … 41654885080 (17 runs) | Upload vectors to Vectorize | Daily `restore-keys: skills-raw-ndjson-` picks the newest key = the weekly placeholder → `existing corpus: 0 skill ids`. filter writes a 0-record `skills.ndjson`; embed `loaded 0 skill records … wrote … (0 vectors)` (exit 0!); upload: `no records loaded` (exit 1). The upload failure is what PROTECTED `skills-latest` from being clobbered with an empty catalog. |
| 11-04, 11-05  | 41851152380, 42049342732 | Run Track 1 (Star Pulse)  | GraphQL 502 storm again (`failure ratio 25.6% > 15%`, `HTTP graphql-502`). No retry on 5xx in `github-graphql.js` → one 502 = 50 repos lost. Classic PAT still valid (200 ok batches interleaved). |

ETag cache: `etag-cache-341` (saved 10-15) is already ~205 B. With zero fetches, Track 2's final `saveETagCache(getETagCache())` re-loads the restored file; the 118 MB-compressed cache exceeds V8's string limit in `loadETagCache` → `catch { return {} }` → writes `{}`. Pre-existing inefficiency (the cache is rebuilt every day anyway); not fixed here — see follow-ups.

## Eliminated

- hypothesis: `SCRAPE_PAT_CLASSIC` (Track 1 / GraphQL) also expired
  evidence: 11-05 run shows `batch 5/274 (200 ok, 50 failed)` — GraphQL returns data for most batches; failures are `graphql-502`, not 401.
  timestamp: 2026-11-05
- hypothesis: OpenAI key / quota problem behind the "Embed skills" failures
  evidence: 09-29 log is the drift guard (`[embed-skills] DRIFT DETECTED … Bailing out`), no OpenAI call attempted; plugin embeds (15.5k records, ~$0.12) succeed in the same runs.
  timestamp: 2026-11-05
- hypothesis: Cloudflare / Vectorize credentials behind the "Upload vectors" failures
  evidence: `[upload] loaded 0 vector records` → `ERROR: no records loaded` is a local file check before any API call.
  timestamp: 2026-11-05
- hypothesis: GHA cache eviction (7-day) wiped the corpus
  evidence: The good `skills-raw-ndjson-343` (236 MB) was restored by the 10-18 weekly run itself; it was the weekly's own 0-record write + `if: always()` save that poisoned the prefix. Eviction only finished the job later (no key older than 10-28 survives now).
  timestamp: 2026-11-05

## Evidence

- timestamp: 2026-11-05
  checked: `gh secret list`
  found: `SCRAPE_PAT 2026-07-16T20:37:52Z`, `SCRAPE_PAT_CLASSIC 2026-06-04T00:18:29Z`, `OPENAI_API_KEY 2026-05-16`, `CF_API_TOKEN 2026-04-11`.
  implication: SCRAPE_PAT age at first 401 = 90 days exactly (GitHub's default fine-grained expiry option).

- timestamp: 2026-11-05
  checked: `gh cache list` (40 newest)
  found: `skills-raw-ndjson-3xx` 196–210 B, `etag-cache-3xx` 203–217 B, `skill-vectors-361/362` 5.80 MB (= committed seed), `plugins-raw-ndjson-3xx` 18.9 MB (healthy — plugin scrape never aborts and merges by repo). No skills-raw/etag key > 1 KB survives.
  implication: Nothing to restore from cache. Reseed required.

- timestamp: 2026-11-05
  checked: release assets
  found: `skills-latest/skills.ndjson` 648 MB @ 2026-09-27T18:00:37Z (101,277 records); `skills-latest-prev` 640 MB @ 09-27; `plugins-latest` plugins 35.8 MB + mcp 288 KB @ 09-27; `skills-raw-ndjson-bootstrap/skills-raw.ndjson` 308 MB @ 2026-05-25 = **33,000** records (downloaded + counted).
  implication: Best available raw seed = `skills-latest` (101k, v2 envelope; filter.js `upcastRecord` passes v2 through; Track 2 skip uses top-level `content_sha`) ∪ May bootstrap (33k v1). The May asset alone would regress the catalog to ~33k.

- timestamp: 2026-11-05
  checked: `.github/workflows/daily-scrape.yml` step order
  found: `Restore skill-vectors cache` is step ~27 (after plugins); `Save skill-vectors cache` is `if: always() && hashFiles(...) != ''`. `data/skill-vectors.ndjson` is COMMITTED (1,078-vector seed), so hashFiles is never empty.
  implication: Any failure before the restore step overwrites the newest cache key with the seed. This is the mechanism behind 19 days of embed failures.

- timestamp: 2026-11-05
  checked: `scripts/scrape.js` lines 592 (write) vs 637 (regression guard)
  found: Full-mode output is written unconditionally BEFORE the >20%-drop guard runs; full mode REPLACES (does not merge) the corpus.
  implication: A 0-result full sweep destroys the corpus on disk even though the step exits 1.

- timestamp: 2026-11-05
  checked: `scripts/lib/github-fetch.js`, `scripts/scrape-discover-repos.js:searchTopic`, `scripts/scrape.js` search loops, `scripts/scrape-plugins.js:rateLimitedFetch`
  found: 401 is not special-cased anywhere; `!res.ok` → warn + break/continue. 403 without `retry-after` is treated as a primary rate limit and retried with NO retry decrement (potential infinite loop on a permission-denied 403).
  implication: An expired/revoked token looks like "quiet day, 0 candidates" to every scraper.

- timestamp: 2026-11-05
  checked: `gh issue list --state open`
  found: #18 `daily-scrape failed (2026-08-18)` label `cron-failure`, 39 comments, last `New failure: 2026-11-05`. Body carries only the date + run URL (no failing step name).
  implication: notify-on-failure works; it is not loud enough to be noticed and carries no diagnostic signal.

## Resolution

root_cause: |
  1. `SCRAPE_PAT` (fine-grained, 90-day expiry) expired 2026-10-14. Every REST scraper (Track 2 repo search, weekly code search, plugin code search) treats HTTP 401 as "skip" and exits 0 with an unchanged or EMPTY corpus.
  2. `Save skill-vectors cache` persists the committed seed whenever an earlier step fails (restore skipped, `if: always()`), poisoning the restore-keys prefix; the embed drift guard then bails every day (09-29 → 10-17).
  3. The weekly full sweep writes its output before its regression guard runs; with 0 results it wiped the on-disk corpus and the `if: always()` save persisted the placeholder (10-18 → today).
  4. `filter.js` / `embed-skills.js` happily process 0 records; the only hard stop (`upload-vectors.js`) is step 30 of 40. GraphQL 5xx has no retry, so GitHub-side blips trip Track 1's 15% gate (09-28, 11-04, 11-05).
fix: |
  PR (branch claude/dazzling-goodall-b4f15a):
  - `scripts/lib/github-auth-error.js` (new, token-free): `GitHubAuthError`, `isAuthFailure(res)` (401, or 403 that is neither a secondary nor an exhausted primary rate limit).
  - `scripts/lib/github-fetch.js`: `rateLimitedFetch` / `fetchWithETag` throw `GitHubAuthError` on auth failure (never silently skip); rate-limit 403 handling unchanged but retries now decrement.
  - `scripts/scrape-plugins.js`: same throw in its private `rateLimitedFetch`.
  - `scripts/lib/github-graphql.js`: 401 → throw `GitHubAuthError`; 5xx → retry with backoff (5s/15s/45s) before marking the batch failed.
  - `scripts/scrape-discover-repos.js`, `scripts/scrape.js`, `scripts/scrape-pulse.js`, `scripts/scrape-plugins.js`: actionable FATAL message on `GitHubAuthError` (names the secret + the runbook), exit 1 before any corpus write. `scrape.js` full-mode regression guard now runs BEFORE the write and also refuses 0 results.
  - `scripts/filter.js`: FATAL on 0 raw records; FATAL if the new catalog is < 50% of the prior `skills.ndjson` (override `FILTER_ALLOW_COLLAPSE=1`). Filter rules / scoring / shape untouched.
  - `scripts/embed-skills.js`: FATAL on 0 input records (override `EMBED_ALLOW_EMPTY=1`) and on 0 output with non-zero input.
  - `scripts/check-github-tokens.js` (new): preflight for `SCRAPE_PAT` (REST) and `SCRAPE_PAT_CLASSIC` (REST + GraphQL); logs status + `github-authentication-token-expiration` only; fails on non-200; `::warning::` when < 14 days left.
  - `.github/workflows/daily-scrape.yml`: preflight step before Track 1; "never persist an empty corpus" guard before the skills-raw save; skill-vectors save gated on the restore step's outcome; notify job gains `actions: read` and puts the failing step name in the issue.
  - `.github/workflows/weekly-discover.yml`: preflight + empty-corpus guard.
  - `.github/workflows/check-tokens.yml` (new): dispatch + weekly Monday cron; opens/comments a `token-expiry` issue on failure.
  - `.github/workflows/reseed-skills-raw.yml` + `scripts/reseed-skills-raw.js` (new): one-shot cache reseed from `skills-latest` ∪ `skills-raw-ndjson-bootstrap`.
  - `CLAUDE.md`: "Recovery: expired PAT / poisoned caches" runbook + known-issue entry.
verification: |
  Unit/subprocess tests for every guard (see PR). Token state confirmed by dispatching `check-tokens.yml` on the branch (see hand-over note). End-to-end recovery requires Dan to rotate `SCRAPE_PAT` first — cannot be exercised from this session.
files_changed:
  - scripts/lib/github-auth-error.js
  - scripts/lib/github-fetch.js
  - scripts/lib/github-graphql.js
  - scripts/scrape-discover-repos.js
  - scripts/scrape.js
  - scripts/scrape-pulse.js
  - scripts/scrape-plugins.js
  - scripts/filter.js
  - scripts/embed-skills.js
  - scripts/check-github-tokens.js
  - scripts/reseed-skills-raw.js
  - .github/workflows/daily-scrape.yml
  - .github/workflows/weekly-discover.yml
  - .github/workflows/check-tokens.yml
  - .github/workflows/reseed-skills-raw.yml
  - CLAUDE.md

## Follow-ups (out of scope here)

- ETag cache is effectively rebuilt daily: `loadETagCache` JSON.parses a >500 MB file and falls back to `{}` on the V8 string-length error. Consider a chunked reader or a size cap. Track 2 ran fine without it (~60 min warm).
- Plugin vectors are re-embedded from scratch every run (`prior vectors: 0`, ~$0.12/day) because `plugin-vectors.ndjson` is not GHA-cached. Add restore/save steps mirroring skill-vectors.
- The weekly full sweep (`scrape.js --mode=full`) is cancelled at the 6h cap every week since at least 09-13 and REPLACES the corpus when it does finish. Reconsider merge semantics.
- `.planning/debug/daily-cron-stalled.md` (April 2026) is still `awaiting_human_verify`; the fix held (5 months of green runs) — move to `resolved/`.
