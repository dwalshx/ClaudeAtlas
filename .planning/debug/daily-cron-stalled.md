---
status: awaiting_human_verify
trigger: "Daily scrape cron stopped producing data after 2026-04-11. Site footer says last updated 4/11, today is 4/14."
created: 2026-04-14T00:00:00Z
updated: 2026-04-14T00:00:00Z
---

## Current Focus

hypothesis: Root cause confirmed — twin bugs in workflow: (1) timeout shorter than cold-scrape duration, (2) `actions/cache@v4` implicit post-save skipped on cancel. Fix applied: bump timeout to 420min, split cache into restore-only + explicit `save@v4` step with `if: always()`.
test: Fix deployed and manual workflow_dispatch triggered. Watching first few minutes to confirm clean start.
expecting: Scrape step begins after Restore ETag cache step. Job runs for up to 7h. On completion OR cancellation OR timeout, Save ETag cache step runs (if: always) and persists whatever is on disk to Actions cache storage. Tomorrow's scheduled run starts warm.
next_action: Wait for user to confirm tomorrow (2026-04-15) that data/history/2026-04-15.json appears and site footer updates.

## Symptoms

expected: Daily GitHub Actions cron runs at 06:30 UTC, scrapes, writes data/history/YYYY-MM-DD.json, deploys, commits back
actual: Site footer shows "last updated 4/11"; only data/history/2026-04-11.json exists; missing 4/12, 4/13, 4/14
errors: None local — issue is in CI
reproduction: `gh run list --workflow=daily-scrape.yml --event=schedule --limit 10` then view failed run logs
started: 2026-04-12 (3 consecutive missed days)

## Eliminated

- hypothesis: GitHub auto-disabled the scheduled workflow (suspect #2)
  evidence: `GET /repos/dwalshx/ClaudeAtlas/actions/workflows/259109462` returns `state: "active"`. Schedule IS firing daily (~07:50–08:30 UTC).
  timestamp: 2026-04-14
- hypothesis: SCRAPE_PAT expired (suspect #1)
  evidence: Scrape step on 4/13 and 4/14 ran for ~5h 50min before cancellation. A 401 from the GitHub API would have failed in seconds, not hours.
  timestamp: 2026-04-14
- hypothesis: Commit step failing silently (suspect #5)
  evidence: Commit step never runs — it's `skipped` because the job cancels at the scrape step.
  timestamp: 2026-04-14
- hypothesis: Bootstrap local etag-cache.json (499 MB) into Actions cache via GitHub Release asset (Option A)
  evidence: Approach is technically viable but requires ~499 MB upload from user's home bandwidth + creates a permanent release asset. With Option B's if:always save step in place, even a partial cache from a cold run now persists, so next run starts warm regardless. Not worth the complexity.
  timestamp: 2026-04-14

## Evidence

- timestamp: 2026-04-14
  checked: Workflow state via GitHub API (unauth, public repo)
  found: Workflow `state: active`, only ONE workflow exists (id 259109462), schedule is firing.
  implication: Eliminates "GitHub disabled cron" hypothesis.

- timestamp: 2026-04-14
  checked: Last 20 workflow runs
  found: ALL 3 scheduled runs since 4/12 are `cancelled`. Only ONE successful scheduled run has ever happened (4/11 #4, which failed fast). Push runs mask the failure by deploying stale data.
  implication: Scheduled cron has effectively never worked end-to-end since the push-vs-schedule split was added.

- timestamp: 2026-04-14
  checked: Job step durations on 4/14 run #19 (id 24388340259)
  found: Scrape step duration = 5h 50min 7s, exactly timeout-minutes: 350. "Post Restore ETag cache" post-action = skipped.
  implication: Job hits timeout, cancellation skips cache save.

- timestamp: 2026-04-14
  checked: GitHub Actions cache inventory via /actions/caches API
  found: total_count: 1 — only npm cache exists. Zero etag-cache-* entries.
  implication: ETag cache has NEVER been successfully saved to Actions storage.

- timestamp: 2026-04-14
  checked: scripts/scrape.js etag cache write logic
  found: saveETagCache() called every 1000 skills (line 627) and at end (line 665). Partial cache file exists on runner disk at cancel time.
  implication: A properly-timed save step can rescue the partial cache.

- timestamp: 2026-04-14
  checked: CLAUDE.md known-issues
  found: "First scrape without the cache takes ~7 hours."
  implication: 350min (5h50m) timeout too short for cold scrape by design.

- timestamp: 2026-04-14
  checked: Local etag-cache.json
  found: 499 MB file last modified 2026-04-10, intact.
  implication: Bootstrap from local cache via release asset is possible but expensive; if:always save step makes it unnecessary.

## Resolution

root_cause: Two compounding bugs in `.github/workflows/daily-scrape.yml`:
  1. `timeout-minutes: 350` (5h 50m) < documented 7h cold-scrape duration → cold scrapes could never complete.
  2. `actions/cache@v4` implicit post-job save is skipped on job cancellation → partial cache on disk never gets uploaded.
  Result: every scheduled run is a cold scrape that times out and discards its cache → infinite loop. Push events mask the issue.
fix: |
  Applied Option B only (skipped Option A after analysis — 499 MB bootstrap via GitHub Release too brittle for a one-shot use case; if:always save makes it unnecessary). Changes to .github/workflows/daily-scrape.yml:

  1. `timeout-minutes: 350` → `timeout-minutes: 420` (7 hours, matches documented cold-scrape duration).
  2. Replaced single `actions/cache@v4` step with:
     - `actions/cache/restore@v4` before the scrape (same key + restore-keys)
     - `actions/cache/save@v4` AFTER the scrape with `if: always() && github.event_name != 'push' && hashFiles('data/etag-cache.json') != ''`.
     The `hashFiles` guard prevents save attempts when the file doesn't exist (e.g. if the runner image is torn down before scrape.js's first checkpoint write).
  3. Preserved existing `if: github.event_name != 'push'` gating so push events still skip all cache + scrape steps.
  4. Preserved existing cache key strategy: `etag-cache-${{ github.run_number }}` with `restore-keys: etag-cache-` — each run writes a new key, restores from any previous match.

  Expected recovery path:
  - Tomorrow's scheduled run (2026-04-15 06:30 UTC) starts cold (no cache in Actions storage yet)
  - Runs for up to 7h, scraper checkpoints etag-cache.json to disk every 1000 skills
  - On completion OR timeout OR cancel: Save ETag cache step runs via if:always and persists cache to Actions storage
  - 2026-04-16 run starts WARM, finishes in 5-10 minutes, commits fresh history snapshot
verification: Manual workflow_dispatch triggered post-deploy; monitored first 2-3 minutes to confirm clean start. Full verification requires observing tomorrow's scheduled run.
files_changed:
  - .github/workflows/daily-scrape.yml
