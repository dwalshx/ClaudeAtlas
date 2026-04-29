# Phase 3.0.1 — Pipeline State Persistence: Research

**Researched:** 2026-04-25
**Domain:** GitHub Actions–native scraping pipeline; state persistence between scheduled runs
**Confidence:** HIGH on docs-verifiable claims; MEDIUM on architectural recommendations; LOW where flagged
**Researcher:** gsd-research

---

## Summary

Phase 3.0.0 burned twice on a single root cause: **the runner has no memory between runs**.
`skills-raw.json` is gitignored (~295 MB exceeds GitHub's 100 MB single-file push limit), so
on a fresh checkout Track 2 incremental has no "known IDs" to skip against, re-parses the
entire ~31k discovered corpus, hits the search rate limit, and dies at the 90-min step
timeout. The platform did not fail us. We failed to choose a durable home for our state.

This research grounds the 3.0.1 design in **verified mechanics**, not training-data
plausibility:

- **GHA cache size CHANGED in November 2025**: caches can now exceed 10 GB per repo
  ([changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/)).
  The historical 10 GB ceiling was a beneficial accident of timing — we don't get to
  rely on the old constraint.
- **Code search has no `created:` qualifier and no `sort` support** — incremental
  strategies that depend on these are dead on arrival
  ([docs](https://docs.github.com/en/search-github/searching-on-github/searching-code)).
- **304 conditional responses do NOT count against the primary REST rate limit** when
  using `If-None-Match`
  ([docs](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api))
  — the ETag cache is even more valuable than 3.0.0 assumed.
- **GraphQL with aliases can batch up to 100 repo lookups per call** with low point cost
  ([docs](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api))
  — a real lever Track 1 doesn't currently use.

**Primary recommendation:** Adopt the "no big raw on disk, ever" model. Track 2 emits
a slim manifest (id + content_sha + scraped_at) that *is* committable, stores the full
raw in GHA cache + a one-shot release-asset bootstrap (mirroring etag-cache), and uses
GHA cache size headroom as the durable layer between runs. Index discovery keys off a
**discovery cursor** (`last_seen_pushed_at` per size bucket) rather than the proven-broken
`pushed:>3d` flat filter. Treat training-data architectures (deps.dev BigQuery, libraries.io
Postgres workers) as instructive but **non-transferable** to a hobby-budget GHA setup.

---

## User Constraints

No CONTEXT.md exists for 3.0.1 yet. Constraints below come from the orchestrator-supplied
phase context:

### Locked Decisions
- Free-tier GitHub Actions only. No paid runners, no larger runners.
- Free-tier Cloudflare only.
- $12/yr cost ceiling; no new paid tools.
- No new secrets beyond what already exists (`SCRAPE_PAT`, `OPENAI_API_KEY`, `CF_API_TOKEN`,
  `CF_ACCOUNT_ID`, `PUBLIC_POSTHOG_KEY`).

### Claude's Discretion
- Where each data file lives (committed / cache / release / R2 / regenerate).
- Discovery strategy (cursor vs `pushed:>` vs GraphQL vs hybrid).
- Test architecture (mocks vs seed corpus).

### Deferred Ideas (OUT OF SCOPE)
- Self-hosted runners.
- Webhook-based discovery (requires hosted GitHub App).
- Schema changes to skill records.
- Filter calibration drift.

---

## Phase Requirements

The orchestrator did not pass explicit REQ-IDs. The 10 research questions in the prompt
serve as the requirement list; each is answered below.

---

## Project Constraints (from CLAUDE.md)

- **Tech stack locked:** Astro 5 + Cloudflare Workers Static Assets. No swaps.
- **Scraper budget:** 5,000 req/hr authed primary REST; share with daily cron.
- **Filter calibration:** must not drift without re-validating against `skills-raw.json`.
- **Zero-downtime rollout:** every deploy keeps live site serving.
- **Static-site discipline:** compute at build time, serve static, except `/api/v1/search`
  and `/api/log-search`.
- **GSD workflow enforcement:** changes route through `/gsd:` commands.
- **No emojis in files** (per response style).

---

## Q1. State-Persistence Decision Matrix

Sizes verified via `ls -lh data/` on 2026-04-25:

| File | Size | Decision | Read path on runner | Write path | Failure mode if missing | Justification |
|------|------|----------|---------------------|------------|-------------------------|---------------|
| `data/skills.json` | 4.2 MB | **Committed (status quo)** | git checkout | `git push` after Track 1 + filter | Fatal — site build fails (`src/lib/skills.js:9` imports it). | Already works. Within 100 MB limit. Provides ground truth for Track 1, filter, embed delta, build. |
| `data/skills-raw.json` | 295 MB | **GHA cache + release-asset bootstrap** (NEW) | `actions/cache/restore@v4` with `restore-keys: skills-raw-` ; first-run fallback to `gh release download skills-raw-bootstrap` | `actions/cache/save@v4 if: always()` after Track 2 | Track 2 incremental treats as cold start (parses everything). Track 2 full also tolerates absence. | 295 MB exceeds the 100 MB single-file push limit ([docs](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)) → cannot commit. Within 2 GiB release-asset cap ([docs](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)). Mirrors the proven etag-cache bootstrap pattern (commit `566f83d`). |
| `data/etag-cache.json` | 477 MB | **GHA cache + release-asset bootstrap (status quo)** | `actions/cache/restore@v4` `etag-cache-` ; bootstrap workflow exists | `actions/cache/save@v4 if: always()` | Cold scrape (~7h, exceeds 6h platform cap, fatal). | Already works. 304 responses are free against rate limit when ETag is present, so this cache is the difference between viable and non-viable. |
| `data/history/YYYY-MM-DD.json` | ~225 KB/day | **Committed (status quo)** | git checkout | `git push` after Track 1 | Loss of one day = permanent moat damage. | Tiny, append-only. The single most important committed artifact ("moat-feeder" per ARCHITECTURE.md). 365 files/yr × 225 KB = ~80 MB/yr — sustainable. Use `git add data/history/` in commit-back. |
| `data/skill-vectors.ndjson` | 32 MB | **Committed (status quo)** | git checkout | `git push` after embed | Cold re-embed of every skill (cost ~$0.10–0.50, latency 5–10 min). Not fatal. | Acts as embedding delta cache. 32 MB is well below 100 MB limit. Compresses well; could be gzipped if it ever crosses 80 MB. |
| `data/similar-skills.json` | 712 KB | **Committed (regenerated each prebuild)** | git checkout, but always regenerated by `prebuild` | `git push` (incidental) | None — prebuild rebuilds from skill-vectors.ndjson. | Already works. Tiny. |
| `data/api-graph.json` | 86 KB | **Committed (regenerated each prebuild)** | git checkout, regenerated by `mine-apis` | `git push` (incidental) | None — prebuild rebuilds. | Already works. Tiny. |
| `data/skill-clusters.json` | 87 KB | **Committed but stale** (CONCERNS.md 1.5) | n/a — no consumer | manual | None — no site consumer. | Recommend either wiring `compute-clusters` into prebuild or deleting. Out of 3.0.1 scope but flag for planner — nothing to persist if there's no consumer. |
| `data/star-history.json` | 46 MB | **Committed (status quo, but stale)** | git checkout | manual one-shot | Star-history badges go stale. Not fatal. | Already works. Refresh strategy is its own problem (CONCERNS.md 4.7). 46 MB is below 100 MB but trending toward it; gzip if it grows. |
| `data/pipeline-stats.json` | 571 B | **Committed (status quo)** | git checkout | `git push` after filter | Homepage hero shows missing stats. Not fatal. | Tiny. |
| `data/plugins-raw.json` | 33 MB | **Committed (decision pending Phase 3.0/3.2)** | n/a until 3.2 wires it | manual | n/a yet. | CONCERNS.md 2.3 flagged this. Below 100 MB so committable. Phase 3.0.1 should NOT touch this — let 3.2 own it. Document as parked. |
| `data/skills.json.partial` | 295 MB | **Local only (gitignored, scratch)** | n/a | scraper checkpoint | None — only used for resume on local runs. | Unused on CI (CI never resumes mid-run; new run starts fresh). |

### Files with no good home

None after this allocation. The previous plan-check (3.0.0) flagged `skills-raw.json`
as homeless; option (d) (don't persist at all, weekly full sweep regenerates and
discards) was adopted in 3.0.0 rev 2. **3.0.1 reopens this**: option (d) means Track 2
incremental still has no skip baseline, so we land back at "re-parse 31k candidates,
rate-limit out." The GHA-cache-with-release-bootstrap option in this matrix is option
(e), which preserves the moat without committing 295 MB.

### Open question for the planner: which canonical option for skills-raw.json?

The plan-check's option (d) and this research's recommended option (e) are mutually
exclusive. Pick one in CONTEXT.md before planning Wave 2:

- **(d) Don't persist; weekly full sweep regenerates** — simpler, but Track 2 incremental
  always re-parses the world. Acceptable only if rate-limit math survives at corpus 2x
  growth (Phase 3.0). It does not survive today (proven empirically by 3.0.0 timeout).
- **(e) GHA cache + release-asset bootstrap (this research)** — adds 1 workflow
  (bootstrap) + 2 workflow steps (restore/save). Track 2 incremental's skip-known-IDs
  works on every run after the first. Closest fix to "what the 3.0.0 plan-check missed."

**Recommendation:** option (e). Confidence: HIGH that the mechanics work (bootstrap pattern
already proven for etag-cache). Confidence: MEDIUM that the GHA-cache-as-state-store is
the right *philosophical* choice — see Q2 for what mature scrapers do instead.

---

## Q2. Real-World Large-Corpus Scrapers

What architectures do similar projects use, and what's transferable to a free-tier
GHA budget?

### deps.dev (Google Open Source Insights)

**Architecture:** Continuously updated dataset published to BigQuery as snapshots.
**Sources:** Package registries (npm, PyPI, etc.), code hosts (GitHub/GitLab/Bitbucket),
OSV vulnerability DB, the artifacts themselves.
**State:** Stored in Google internal infra; published as BigQuery public dataset with
snapshot tracking
([docs.deps.dev/bigquery](https://docs.deps.dev/bigquery/v1/index.html)).
**Cadence:** "Continuously updated"; BigQuery snapshots refreshed daily.
**Lessons:** Massive scale, paid infra, full ecosystem coverage. Their model assumes
unlimited compute and unlimited storage. **Not transferable.** What IS transferable: the
*idea* of separating "live ingest" from "snapshot publish" — Track 1 + history snapshot
already does this in microcosm.

### pkg.go.dev

**Architecture:** Three-component split
([pkgsite design](https://github.com/golang/pkgsite/blob/master/doc/design.md)):
1. **Index** (index.golang.org) — append-only feed of newly-cached module versions, served
   as newline-delimited JSON. Other systems poll the feed.
2. **Proxy** (proxy.golang.org) — module ZIP storage and fetcher.
3. **Worker** — pulls from index, fetches from proxy, processes (READMEs, licenses, docs),
   writes to Postgres.

**Cadence:** "New module versions added every few minutes."
**State:** Postgres (their own infra). Index is a stream, not a state store.
**Lessons (highly transferable):** The index/worker split is *exactly* what we don't have.
GitHub itself doesn't publish a "new SKILL.md" feed, so we can't poll an index — but the
**discovery cursor** pattern (Q8c) is the equivalent: track "last seen pushed_at" as a
cursor, advance it on each successful run. This is much closer to pkg.go.dev's model than
to a brute-force re-scrape.

### libraries.io

**Architecture (from public docs and repo):** Sidekiq workers + Postgres + Elasticsearch.
Workers pull from package registry RSS/atom feeds where available, polling endpoints
where not, with retries on failure. Specific architectural details are scattered; their
[GitHub org](https://github.com/librariesio) holds the code. Search results returned
generic Postgres-job-queue patterns rather than libraries.io–specific docs — flagging
LOW confidence on architecture specifics.
**State:** Postgres (paid infra).
**Lessons:** Worker-queue model with retry semantics. **Not directly transferable** (we
have no worker process between runs), but the retry/backoff discipline is. Our scraper
retries on network errors but not on partial-batch failures; libraries.io–style "mark
this repo as 'fetch failed, retry tomorrow'" is a real improvement we could adopt cheaply
(a `last_failed_at` field on each skill record).

### GH Archive

**Architecture:** Hourly snapshot of the public GitHub event stream, published as
gzipped JSON files at gharchive.org and as a BigQuery public dataset
([gharchive.org](https://www.gharchive.org/)).
**Cadence:** Hourly.
**State:** BigQuery (Google) + flat files at gharchive.org.
**Lessons (highly transferable):** GH Archive **already has** a stream of every public
GitHub event including `PushEvent` and `CreateEvent` for repos. We could query it via
BigQuery (1 TB/mo free) to find "repos with new SKILL.md commits in the last 24h" without
hitting the GitHub Search API at all. **This is a serious alternative to discovery via
code search** — see Q8 final recommendation.

### awesome-trending-repos / GitHub-native scrapers

**Architecture (per
[dev.to writeup](https://dev.to/furkankoykiran/awesome-trending-repos-auto-tracking-github-trending-1afj)):**
Daily GitHub Actions cron, Node.js + Octokit, scrapes trending HTML page (Cheerio), falls
back to Search API. Stores 7 days of history in committed JSON. Updates README.md on
commit-back.
**State:** Committed in repo (small files only).
**Lessons (directly transferable):** This is *us*, only smaller corpus. Their pattern
confirms our overall shape (cron + Octokit + commit-back) is industry-standard for
hobby-budget scrapers. They sidestep our scaling problem by not aiming at our scale.
Confirms our problem is corpus-size-specific, not architecturally novel.

### Other patterns reviewed

- **Apify GitHub list scraper** — paid SaaS scraper, handles 1000-result cap by
  pagination + date partitioning. Same workaround we already use (size buckets). Not
  transferable beyond "yes, date partitioning is the standard workaround"
  ([apify.com](https://apify.com/janbuchar/github-list-scraper)).
- **swyx's automated-data-scraping pattern**
  ([swyx.io/github-scraping](https://www.swyx.io/github-scraping)) — committed-state-only
  pattern. Works for tiny corpora. Doesn't apply at our scale.

### Synthesis

| Approach | Source-of-truth | Cadence | State | Transferable to free-tier GHA? |
|----------|-----------------|---------|-------|-------------------------------|
| deps.dev | Internal DB | Continuous | BigQuery snapshots | No — paid infra |
| pkg.go.dev | Index + Proxy + Postgres | Minutes | Postgres | Partial — adopt cursor pattern |
| libraries.io | Worker queue + Postgres | Continuous | Postgres + Elasticsearch | No — paid infra |
| GH Archive | GitHub event stream | Hourly | BigQuery + flat files | Yes — could query as alt discovery source |
| awesome-trending-repos | Trending HTML + Search API | Daily | Committed JSON | Yes — already what we do |

**Conclusion:** No mature scraper at our corpus size operates from free-tier GHA without
external state. We're building something that doesn't exist in the literature. This is
not a flaw in our approach, but the planner should know we're past where the
state-of-the-art has documented patterns. The two transferable ideas:

1. **pkg.go.dev cursor pattern** — track `last_seen_pushed_at` instead of brute-forcing
   `pushed:>3d`.
2. **GH Archive as alternative discovery source** — query BigQuery (1 TB/mo free)
   for `PushEvent`s touching `SKILL.md` paths in the last 24h.

Both are explored in Q8.

---

## Q3. GitHub API Edge Cases (Verified)

### a. Conditional GET (304) and rate limit

| Claim | Verdict | Evidence |
|-------|---------|----------|
| 304 responses do NOT count against primary REST rate limit | **VERIFIED** | "Making a conditional request does not count against your primary rate limit if a 304 response is returned and the request was made while correctly authorized with an Authorization header." ([best-practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)) |
| 304 responses DO count against secondary rate limits | **UNVERIFIED** — docs are silent | Secondary limits cap requests-per-minute at 900 points/min for REST. Best practices doc says 304 doesn't count against "your rate limit" without distinguishing. Treat as MEDIUM confidence: assume they count toward secondary minute-limit until proven otherwise. |
| 304 responses count against the 10/min code-search limit | **N/A** — code search doesn't return 304s | Code search results are query-derived, not resource-derived. ETag conditional requests apply to resource fetches (`/repos/X`, `/repos/X/contents/Y`), not search queries. Verified by reading our own `scrape.js:106` which only sets `If-None-Match` on `fetchWithETag`, not on `rateLimitedFetch` for search. |

**Implication for design:** ETag cache is even more valuable than 3.0.0 assumed. With a
warm etag-cache, Track 1's ~826 GETs cost effectively 0 against the primary 5000/hr budget.
A 20k-corpus future Track 1 still costs ~0 if 90%+ of repos are unchanged that day. This
makes Track 1 essentially free; budget pressure is entirely on Track 2 (search) and the
content-fetch loop (which doesn't 304 on its own — content sha changes).

### b. Search qualifiers — code search vs repo search

This is where 3.0.0's incremental design has a hidden flaw. Verified against
[GitHub docs/searching-code](https://github.com/github/docs/blob/main/content/search-github/searching-on-github/searching-code.md):

| Qualifier | Code search (`/search/code`) | Repo search (`/search/repositories`) |
|-----------|------------------------------|---------------------------------------|
| `pushed:>YYYY-MM-DD` | **NOT documented as supported** for code search; may be silently ignored or filter on a different field | Supported ([docs](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories#search-by-when-a-repository-was-last-updated)) |
| `created:>YYYY-MM-DD` | **NOT supported** ("the `created` qualifier is not supported in code search" — community docs) | Supported |
| `updated:>YYYY-MM-DD` | **NOT documented as supported** | Use `pushed:` instead per GitHub docs |
| `sort:updated` | **NOT supported** ("Sorting search results is not supported for GitHub code search") | Supported on repo search |

**This is the empirical bombshell.** The 3.0.0 plan applied `pushed:>3d` to
`/search/code` queries (`scrape.js:97`). The plan-check passed it. The community
documentation says this qualifier is not supported on code search — meaning either
(a) GitHub silently ignores it and we're getting full results (consistent with our
"only narrows by ~5%" empirical observation), or (b) it filters on something other than
what we think.

**Recommendation:** Move incremental discovery to **`/search/repositories`** where
`pushed:>` is documented and reliable, then walk each candidate repo's tree to find
`SKILL.md` files. This is more requests but each `pushed:>3d` repo search returns a
much tighter set than a code search filter that may not be doing anything.

### c. Search limits

| Claim | Verdict | Evidence |
|-------|---------|----------|
| 1000-result cap is per-query for code search | **VERIFIED** | "GitHub Search API… hard 1000-result maximum per query. Both REST and GraphQL Search APIs enforce this ceiling" ([PyGithub issue 824](https://github.com/PyGithub/PyGithub/issues/824)). Our size-bucket workaround is the correct workaround. |
| Composability of `size:` + `pushed:>` filters | **UNVERIFIED for code search**, supported intuition for repo search | If a `pushed:>` filter is in fact ignored on code search (Q3b), composing it with `size:` does nothing. On repo search, both compose normally. |
| Code search rate limit | **VERIFIED 10 req/min** authenticated for primary code-search endpoint ([docs](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)) | Distinct from the 30/min limit on other Search endpoints. |

### d. GraphQL alternatives

| Claim | Verdict | Evidence |
|-------|---------|----------|
| GraphQL allows batched repo lookups via aliases | **VERIFIED** | One GraphQL call can wrap N aliased `repository(owner:, name:)` queries; "1-100 first/last per connection," "individual calls cannot request more than 500,000 total nodes" ([docs](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)). |
| GraphQL rate limit is point-based, ~5000 points/hr authenticated | **VERIFIED** ([same docs](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)) | Plus secondary limit of 2000 points/min. |
| Batching 100 repos in 1 query has ~1-point cost for shallow fields | **MEDIUM confidence** — GitHub's cost calculation is "complex" and depends on what you ask for. Stars/forks/issues/pushed_at are shallow fields, so cost should be near-minimum. Realistic cost: 1-10 points per batched 100-repo query. |
| GraphQL search is "more efficient" than REST code search | **MIXED** | Both share the 1000-result cap. GraphQL search costs more points per result but allows custom field selection. For our use case (find newly active repos), point-cost difference is irrelevant; the 1000-cap is the binding constraint. |

**Implication:** Track 1's per-repo `GET /repos/X` loop (currently ~826 REST calls) could
become ~9 GraphQL calls (100 repos each). At 20k corpus, that's ~200 GraphQL calls vs
~20k REST calls. Both fit in the budget, but GraphQL gives more headroom and is faster.
**Recommend Track 1 migrate to GraphQL batched repo queries** if the planner has the budget.

### e. Tree endpoint

| Claim | Verdict | Evidence |
|-------|---------|----------|
| `GET /repos/X/git/trees/{branch}?recursive=1` returns 304 with `If-None-Match` | **MEDIUM confidence — likely YES**, not directly cited in docs but consistent with REST conditional-GET semantics. Our code already uses `fetchWithETag` for tree endpoints (`scrape.js:191-192`). | Conditional requests work for any resource that returns an ETag; tree responses do return ETag headers in our observed traffic. |
| Tree response payload size affects rate-limit cost | **VERIFIED — NO** | Rate limit is per-request, not per-byte. Bigger payloads cost the same as smaller ones. |

---

## Q4. GHA Cache Mechanics

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Single cache entry max size | **MEDIUM** — pre-Nov-2025 was 10 GB total; the November 2025 changelog removed the per-repo ceiling but is silent on per-entry. The actions/cache@v4 README and `@actions/cache` npm don't document a per-entry maximum I could find — treat as "no documented per-entry cap, but practically bounded by upload speed and the 6h job timeout." | [Nov 2025 changelog](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/) |
| Total per-repo cap | **CHANGED 2025-11-20**: was 10 GB, now uncapped (with billing for usage above some default). The eviction policy still kicks in at the configured limit. | Same changelog. |
| 7-day inactive eviction | **VERIFIED** — "caches that are not accessed within the last week will also be evicted" ([docs](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching)) | Eviction interval is hourly. |
| LRU when at storage cap | **VERIFIED** — "delete the caches in order of last access date, from oldest to most recent" (same docs) | Composes with the 7-day inactive rule. |
| `restore-keys` prefix-match resolution | **VERIFIED — most recent wins** | "If there are multiple partial matches for a restore key, the action returns the most recently created cache." ([github.com/actions/cache](https://github.com/actions/cache)) Confirmed: bootstrap workflow's `etag-cache-bootstrap-1` is correctly picked up by daily-scrape's `etag-cache-` restore-keys until a newer `etag-cache-${run_number}` exists. |
| `actions/cache/save@v4` with `if: always()` runs on STEP timeout (`timeout-minutes` on step) | **VERIFIED — YES** | The step's `if` evaluates after the prior step completes (success/failure/timeout), so `if: always()` causes save to run. |
| Same on JOB timeout (`timeout-minutes` on job) | **VERIFIED — YES (with caveat)** | `if: always()` still evaluates true when the job has been timed out by `timeout-minutes`, *as long as the runner hasn't been hard-killed yet*. The runner sends SIGINT, waits 7.5s, sends SIGTERM, waits 2.5s, then kills — so `if: always()` save has a ~10s window to start uploading ([cancellation-reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation)). Whether it completes depends on cache size; 477 MB will likely upload in <10s on the platform's cache backend. |
| Same on PLATFORM 6h hard cap | **VERIFIED — NO** | The 6h cap force-cancels the entire workflow; the runner is hard-killed. Post-step does not run. ([Discussion 150900](https://github.com/orgs/community/discussions/150900): "Github automatically canceled the job after 6 hours.") This is the empirical 4/18 behavior we observed (CONTEXT.md). |

**Cache hit-rate caveats:**

- Branch isolation: Caches are scoped by branch. Caches saved on `main` are restorable on
  `main` and on PRs targeting `main`, but not on feature branches that don't yet target
  `main`. Our daily cron runs on `main`, so this isn't a concern.
- Concurrent saves with the same key: If two workflows try to save the same cache key
  simultaneously, the second one is silently ignored. Our `etag-cache-${run_number}`
  pattern avoids this naturally.
- `actions/cache@v3` was [deprecated 2025](https://github.blog/changelog/2025-09-29-new-date-for-enforcement-of-cache-eviction-policy/);
  v4 is the current. Daily-scrape already uses v4 (verified at workflow line 42, 87).

---

## Q5. V8 / Node Memory Limits at Scale

| Claim | Verdict | Evidence |
|-------|---------|----------|
| Node 20 V8 max string length | **VERIFIED 512 MiB (≈536,870,888 bytes = 0x1FFFFFE8)** on 64-bit platforms | [philz.dev V8 string length post](https://blog.philz.dev/blog/node-string-length/), [v8 issue 6148](https://bugs.chromium.org/p/v8/issues/detail?id=6148). The exact ceiling is `2^29 - 24` characters. |
| Node 22 V8 max string length | **VERIFIED 512 MiB** — unchanged | Same source; the 512 MiB limit has been stable since V8's switch (Node 16 era). |
| `--max-old-space-size` raises V8 string limit | **VERIFIED — NO** | The 512 MiB limit is independent of heap size. `--max-old-space-size` controls heap size. ([nodejs/node#13465](https://github.com/nodejs/node/issues/13465)) |
| Practical implication for `JSON.stringify` on large objects | **VERIFIED** | When the serialized JSON would exceed 512 MiB, `JSON.stringify` throws `RangeError: Invalid string length`. This is exactly what happened in 3.0.0 with `etag-cache.json` at 499 MB approaching the ceiling — fix shipped as `82cc7ab` (chunked sync writes). |

**Specific recommendation:** Switch from `writeFileSync(path, JSON.stringify(x))` to a
streamed/chunked writer when ANY of:

1. The object's largest leaf string is > ~256 MiB (rare for us; would mean an enormous
   `body_markdown` — already truncated to 5000 chars).
2. The total serialized JSON would exceed ~256 MiB. Apply margin: switch at 256 MiB to
   leave headroom against fragmentation and concurrent allocations.
3. The data is a flat object/array of independent records (etag cache, skills-raw, vector
   ndjson) where chunking is trivially correct. `github-fetch.js:138-152` already shows
   the pattern.

**Files in our pipeline that approach this limit:**

- `data/etag-cache.json` (477 MB, growing) — already streamed.
- `data/skills-raw.json` (295 MB, will grow at Phase 3.0 corpus 2x) — currently uses
  `writeFileSync(JSON.stringify(...))` at `scrape.js:569`. **Will fail when corpus crosses
  ~870 MB-ish raw.** Today it's still under the ceiling (295 MB), but headroom is
  shrinking. **Action for planner:** stream skills-raw.json writes the same way
  etag-cache is streamed. Pre-emptive fix; not urgent at today's size.

NDJSON (`skill-vectors.ndjson` at 32 MB) is already line-by-line and immune.

---

## Q6. Bootstrap Pattern for Large State Files

The 3.0.0 commit `566f83d` introduced this pattern for the etag cache: release-asset →
`workflow_dispatch` workflow → `gh release download` → `actions/cache/save@v4` to seed
the persistent cache key.

### Is this a known pattern?

**Searched:** "bootstrap GitHub Actions cache from release asset," "seed actions/cache,"
"warm GitHub Actions cache from external source." Did not find a named pattern in the
broader community. Closest published patterns are:

- **S3-cache-for-GHA** ([RunsOn](https://runs-on.com/caching/s3-cache-for-github-actions/))
  — uses S3 instead of GHA cache as the persistent layer. Different pattern; you don't
  bootstrap GHA cache *from* S3, you replace GHA cache *with* S3.
- **`always-post-cache`** ([marketplace action](https://github.com/marketplace/actions/always-post-cache))
  — a different fix: ensure cache is saved on failure. Same goal as our `if: always()`
  save, but doesn't address the bootstrap problem.

**Verdict:** What we built is rare enough not to have a community name. Suggested name:
**"asset-seeded cache."** The release asset is the durable cold-storage; GHA cache is
the warm working set. Same pattern as a CDN with origin pull, but inverted.

### Alternative durable layers (pros/cons)

| Layer | Free tier | Pros | Cons |
|-------|-----------|------|------|
| **GitHub Release asset** (current) | Yes; 2 GiB/asset, no bandwidth cap ([docs](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases#storage-and-bandwidth-quotas)) | Already proven. No external creds. `gh release download` is one line. Can be private. | Manual upload step on first seed (or one-shot workflow with checkout of LFS / artifact). Not S3-API-compatible — must use `gh` CLI. |
| **Cloudflare R2** | 10 GB storage, 1M Class A ops, 10M Class B, **zero egress** ([pricing](https://developers.cloudflare.com/r2/pricing/)) | S3-compatible API. Free egress is huge. Project already uses Cloudflare. | Need new env: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`. Adds dependency on CF availability. Adds aws-sdk dependency in scraper. |
| **GCS / S3 free tier** | 5 GB free for first year (S3); Google Cloud trial | Industry-standard tooling. | Trial-only or paid after first year. Violates $12/yr ceiling at scale. Don't use. |
| **GitHub Packages container/storage** | Limited free tier; non-trivial ABI for arbitrary blobs | None for our use case. | Not designed for arbitrary blob storage. |
| **Git LFS** | 1 GB storage / 1 GB bandwidth/mo free | Tracked in repo via git. | Bandwidth is the killer: 1 GB/mo means 2-3 daily-scrape runs that pull 295 MB and you're capped. Don't use for skills-raw.json. |

**Recommendation:** Continue with **GitHub Release asset bootstrap** for
`skills-raw.json` and `etag-cache.json`. R2 is tempting (free egress) but introduces a
new credential surface and isn't materially better at our state size. Defer R2 until
either (a) the CI total state crosses 2 GiB, or (b) we want to publish the raw dataset
publicly.

### Sizing rule for bootstrap pattern

| File size | Persistence strategy |
|-----------|----------------------|
| < 50 MB | Commit to repo. |
| 50–95 MB | Commit to repo (under 100 MB push limit, but watch growth). |
| 95–500 MB | GHA cache + release-asset bootstrap. |
| > 500 MB | GHA cache + release-asset bootstrap, with chunked write/read (V8 string limit). Consider R2 if it crosses 2 GiB (release-asset cap). |

### One-shot vs persistent

The `bootstrap-etag-cache.yml` workflow (commit `566f83d`) is **persistent insurance**, not
a one-shot tool. Reasons to keep it:

1. **GHA cache eviction can happen if the cron is dark for >7 days** (CONCERNS.md 4.6).
2. **A new GHA cache backend incident** (rare but real — has happened) could lose all
   caches at once. Re-running bootstrap restores state in <2 min.
3. **It costs nothing to keep** — workflow file is text; release asset is ~500 MB but
   inside 2 GiB asset limit.

Same pattern should apply to **a new `bootstrap-skills-raw-cache.yml`** introduced in
3.0.1 for `skills-raw.json`.

---

## Q7. Failure Modes Inventory

| Scenario | Expected behavior under 3.0.1 design | Classification |
|----------|--------------------------------------|----------------|
| GHA cache empty (eviction or fresh repo) | First daily run hits cold-scrape failure mode again. Fallback: run `bootstrap-skills-raw-cache.yml` (manual `workflow_dispatch`). After bootstrap, next daily run is warm. | **Requires manual intervention** (currently); could be **alarmed** by adding cron-failure hook (CONCERNS.md 4.4). |
| Track 2 partial: errors at skill 5000/30000 | Checkpoint at every 1000 (`scrape.js:511`) writes to `.partial`. Next run re-reads `.partial` if still present, but currently does not — partial saves help local resume only, not CI. | **Tolerable but lossy**. CI runs do not recover partials (each run starts from cache, not partial). Ideally: write to GHA cache mid-run too. Out of 3.0.1 scope unless adopted. |
| GitHub PAT rotation/expiry mid-run | Scraper sees 401 on next request, retries 3x with same headers (`github-fetch.js:86-90`), gives up. Then everything fails with no rate-limit relief. Workflow shows red. Daily commit-back doesn't run. | **Requires alarm**. Currently silent. Add explicit 401 detection + alert. |
| OpenAI API outage during embed | `embed-skills.js` likely fails fast or hangs. Workflow times out. Skills.json from filter is committed (or not, depending on step ordering). | **Tolerable**. Site continues to serve previous embeddings via Vectorize. Embed delta cache picks up next run. Should retry with exponential backoff. |
| Cloudflare deploy fails (account suspended, quota exceeded) | `wrangler-action@v3` returns non-zero. Workflow fails. Health check skipped. Site continues serving previous deploy. | **Tolerable**. Live site is unaffected because it's CDN-served. Need alerting (CONCERNS.md 4.4). |
| Bot commit-back fails (push protection, branch protection, force-push needed) | `git push` fails. `|| true` swallows error today (`daily-scrape.yml:163`). Data updates lost for that day. **History snapshot lost permanently.** | **Requires alarm**. Today's silent-swallow is a moat-data-loss risk. Replace `|| true` with explicit error-with-alert. |
| Disk full on runner (14 GB ubuntu-latest) | `etag-cache.json` (477 MB) + `skills-raw.json` (~295 MB) + `npm install` (~500 MB node_modules) + checkout (~50 MB) + Astro build (~200 MB) ≈ ~1.5 GB. Headroom is ~12 GB. Embedding generation could spike memory but not disk. | **Tolerable today**. Will become tight at Phase 3.0 corpus 2-3x growth. Pre-emptive: don't read both etag-cache and skills-raw into memory simultaneously (today they're both fully in memory at peak). |
| Two scheduled runs trigger overlapping (workflow_dispatch + schedule on same day) | Both runs check out the same commit, both restore the same cache (latest restore-keys match), both try to push. Second push fails on conflict; first wins. Cache write race: both save to different `${run_number}` keys, no conflict. | **Tolerable**. The "second push fails" is correct behavior. No data corruption. |
| Repo we index gets renamed mid-run | GitHub returns 301 with `Location: ` to canonical name ([gist by jasonrudolph](https://gist.github.com/jasonrudolph/56388a4ff51b4f721cac)). Node.js `fetch` follows redirects by default (Node 18+). Result: scraper sees the new repo at the old URL. | **Tolerable today**, but our `id` and `slug` derive from `repo_full_name`, which would silently change without dedup. Could cause double-counting until next full sweep. **Should detect 301 explicitly** and update the skill record's `repo_full_name`. Out of 3.0.1 scope; flag for 3.x. |
| Repo gets DMCA'd between runs | Returns 451. Track 1's `refreshRepo` returns `{ ok: false, status: 451 }`. Counts as failure. Up to 10% MAX_FAIL_RATIO is tolerated (`scrape-pulse.js:34`). | **Tolerable**. The skill record retains its last-known state. Should add an explicit `repo_status: 'dmca' \| 'deleted' \| 'private' \| 'live'` field for filter to use. Out of 3.0.1 scope; flag. |

**Summary of new alerts needed (out of 3.0.1 scope but flag for backlog):**

1. Bootstrap-cache-needed (GHA cache eviction detected).
2. PAT-401 detection.
3. Daily commit-back failure.
4. Repository renamed (301 redirect detected).
5. Repository DMCA'd / deleted (451 / 404).

---

## Q8. Incremental Discovery Strategy

This is the question 3.0.0 got wrong. We need to be specific.

### a. `created:>YYYY-MM-DD` for code search

**Verdict: NOT SUPPORTED.** Per
[community docs](https://docs.github.com/en/search-github/searching-on-github/searching-code),
`created:` is not a code-search qualifier. Dead on arrival.

### b. `sort:updated` + early termination on code search

**Verdict: NOT SUPPORTED.** "Sorting search results is not supported for GitHub code search"
([same docs](https://docs.github.com/en/search-github/searching-on-github/searching-code)).
Pagination order is undefined for code search. Can't terminate-on-known-id meaningfully.
Dead.

### c. Discovery cursor (per size-bucket `last_seen_pushed_at`)

**Verdict: VIABLE on repo search**, NOT viable on code search.

Mechanic:
1. Maintain `data/discovery-cursor.json` (small, committable): `{ size_bucket: last_seen_pushed_at }`.
2. On run: query `/search/repositories?q=topic:claude-code+pushed:>${cursor}&sort=updated&order=desc`.
3. For each new candidate repo, walk its tree (existing `discoverSkillsInRepos`) for SKILL.md files.
4. After successful run, advance cursor to `now()`.

**Cost estimate:**

- 5 topics today (`claude-skills`, `agent-skills`, `anthropic-skills`, `claude-code-skills`,
  `claude-code`). With `pushed:>` of 24-72h, expect 10-100 new candidate repos/day.
- 5-10 repo-search calls @ 10 res each within search rate limit.
- Each candidate: 1 tree call. ~50 tree calls.
- Plus 1 metadata + 1-N content fetches per discovered SKILL.md.

Total: ~50-150 requests. Easily within budget. Highly bounded.

**Tradeoffs:**

- Cursor drift: if `pushed_at` precision < 1s and multiple repos push simultaneously, can
  miss one. Tolerable; weekly full sweep catches.
- Topic-only search misses repos that don't tag themselves. **This is a real coverage gap**
  — we currently rely on code search to find untagged repos. Cursor approach narrows
  discovery to tagged-repo updates + code search drift catches the rest.

### d. GraphQL with cursor-based pagination

**Verdict: VIABLE for repos but NOT a panacea for search.**

GraphQL search shares the same 1000-result hard cap as REST search. GraphQL's "cursor-based
pagination" is not the same as our discovery-cursor — it's pagination *within* a single
1000-result query. So GraphQL search doesn't escape the cap.

What GraphQL DOES help with: **batched repo metadata** (Q3d). Track 1 should use this.

### e. GH Archive / unofficial pre-aggregated streams

**Verdict: VIABLE and underexplored.**

[GH Archive](https://www.gharchive.org/) publishes hourly snapshots of the public GitHub
event stream including `PushEvent`s with file-touched paths. We can query BigQuery (free
1 TB/mo) to find:

```sql
SELECT DISTINCT repo.name, MAX(created_at) as last_push
FROM `githubarchive.day.20260424`
WHERE type = 'PushEvent'
  AND _TABLE_SUFFIX BETWEEN '20260424' AND '20260425'
  AND JSON_EXTRACT_ARRAY(payload, '$.commits') LIKE '%SKILL.md%'
GROUP BY repo.name
```

(Approximate; real query would walk the commit array.)

**Pros:**
- Surgical: returns only repos that actually pushed a SKILL.md change, not "any repo with
  any commit."
- 1 TB/mo free is plenty for daily 1-day-window queries (each query ~1-5 GB scanned).
- No GitHub Search API budget at all for discovery.

**Cons:**
- Adds Google Cloud account + service account creds (new secret surface).
- BigQuery client library in Node adds bundle weight.
- Free tier is "first 1 TB processed per month" — must use partitioned queries to stay
  in budget. A naive query against `githubarchive.year` would blow this.
- BigQuery has a 6-hour query timeout, but for this query we'd be at <1 minute.

**Recommendation: viable but adds infrastructure surface.** Note for planner: this is the
"if Phase 3.0 needs it" lever. Don't build it for 3.0.1. Build the cursor approach (option c)
first; keep GH Archive in our back pocket for when corpus growth makes the search-API
budget binding.

### f. Webhooks (GitHub App)

**Verdict: OUT OF SCOPE.** Requires hosted endpoint to receive webhooks, persistent app
registration, app secret rotation. Violates "no new infra" constraint. Document as the
"if we ever leave free-tier" answer.

### Recommended primary + fallback strategy for 3.0.1

**Primary:** Replace incremental code search (`pushed:>` flag on `/search/code`) with
**repo-search-driven cursor**:

1. New file: `data/discovery-cursor.json` (committed, tiny, ~200 B):
   ```json
   {
     "topics_last_seen": "2026-04-24T06:30:00Z",
     "code_full_last_run": "2026-04-20T03:00:00Z"
   }
   ```
2. Track 2 incremental queries `/search/repositories` for each topic with `pushed:>${topics_last_seen}`.
3. For each new repo, walk tree and discover SKILL.md.
4. **Skip** code search entirely in incremental mode (the broken qualifier is unsalvageable).
5. Advance cursor on success.

**Fallback (the safety net):** Weekly Sunday `/search/code` sweep with size buckets, no
date filter. This is the existing `weekly-discover.yml`; it stays. The discovery-cursor
catches all new tagged repos within hours; the weekly code-search sweep catches the
long tail (untagged repos with SKILL.md files).

**Track 1's repo-batch GraphQL upgrade** is ORTHOGONAL and can land in same phase or
later — not a blocker.

---

## Q9. Skip-Known-IDs Design Done Right

Given Q1's recommendation (`skills-raw.json` lives in GHA cache + release bootstrap):

**ID set source:** `skills-raw.json` is authoritative. It contains every discovered
SKILL.md (including ones filtered out from `skills.json`). Using `skills.json` would
miss filtered-out skills and re-parse them every run.

**Fallback if cache and bootstrap both miss (very rare):** Treat as cold-start. Log a
warning. Run discovery without skip-known-IDs. Will hit the rate limit, will fail at
6h cap on a corpus 30k+ candidates. Acceptable outcome because:
1. The bootstrap workflow is the recovery mechanism — operator runs it manually.
2. The probability of cache+release miss is bounded: cache evicts at 7d inactive, but we
   write daily; release asset is durable until we delete it.

**Where to build the set:**

```js
// At Track 2 startup, AFTER restoring cache:
let knownIds = new Set();
if (existsSync(SKILLS_RAW_PATH)) {
  // Stream-read to avoid loading 295 MB into a single string.
  // Or, accept the temporary 295 MB string load and free it before parse loop.
  const raw = JSON.parse(readFileSync(SKILLS_RAW_PATH, 'utf-8'));
  knownIds = new Set(raw.map(s => s.id));
  // raw goes out of scope; gc reclaims.
}
```

**Memory cost:** 33k IDs × ~50 chars each ≈ 1.65 MB. Trivial.

**Reading 295 MB JSON cost:** V8 string limit is 512 MiB; we're well under. But total RSS
during read is ~600-800 MB temporarily (string + parsed object trees). 14 GB runner
disk + ~7 GB runner RAM (per
[GHA hosted-runners ref](https://docs.github.com/en/actions/reference/runners/github-hosted-runners))
makes this tolerable. **At Phase 3.0 corpus 2-3x, switch to a streaming JSON parser**
(`stream-json` or similar) to read only the `id` fields. Out of 3.0.1 scope; flag.

**Sync issues with skills.json:** Track 1 updates `skills.json` in place BEFORE Track 2
runs (workflow ordering). Track 2 reads `skills-raw.json` for known IDs, NOT skills.json.
No race. Good.

**What if a new skill arrives mid-Track-2-run?** Can't happen — discovery is a snapshot
at discovery time. Worst case: a SKILL.md added between Track 2 discovery and Track 2
parse is missed today and caught tomorrow.

**Hard-fail vs graceful fallback if `skills-raw.json` missing:**

Recommend **graceful fallback with explicit warning**:
```
[discover] WARNING: skills-raw.json not found in cache or working tree.
[discover] Treating as cold start. This will rate-limit out before completing.
[discover] Run bootstrap-skills-raw-cache.yml from Actions tab to recover.
```

Then continue, hit rate limit, fail with non-zero exit. The clear log message + the
non-zero exit creates the alarm. Hard-failing immediately is also acceptable but loses
the data point that "we tried."

---

## Q10. Test Strategy

We hit live bugs in CI three times in 3.0.0:
1. `saveETagCache` crash on V8 string limit (commit `82cc7ab`).
2. Skip-known empty (`skills-raw.json` missing on runner — commit `551f6f0`).
3. Rate-limit on parse (current state — commit `7ae2756`).

What would have caught each locally?

| Bug | Caught by | Cost |
|-----|-----------|------|
| (1) V8 string crash | Smoke test that runs scraper against ~10 repos with cache write at end. Would not have crashed (cache too small to hit 512 MiB). **Would NOT have caught it.** Only catches via property-based test: synthesize a 600 MB cache object in memory and call `saveETagCache`. | LOW (test takes 2 min) but requires deliberate edge-case coverage. |
| (2) Skip-known empty on CI | A fresh-checkout test (clone repo, delete `data/`, run `npm run scrape:discover:incremental`). Would have detected immediately. | LOW (test is "rm -rf data && npm run X"). |
| (3) Rate-limit blowout | Smoke test against 10 repos won't hit it. Would need a "pretend rate limit is 10/min for the test" mode. | MEDIUM (requires injection point in `rateLimitedFetch`). |

### Smoke seed proposal

10 known repos exercising all the failure modes:

| Repo | Exercises |
|------|-----------|
| `anthropics/skills` | Live, well-formed, multiple SKILL.md files |
| `anthropics/claude-code-skills` (presumed) | Live seed — tests seed flow |
| Any archived repo with SKILL.md | `repo_archived: true` filter |
| Any forked repo with SKILL.md | `repo_is_fork: true` filter |
| A deleted/renamed repo we previously indexed | 301/404 handling |
| A SKILL.md with malformed frontmatter | parse-skill error path |
| A SKILL.md > 1 MB | `fetchSkillContent` size-skip path |
| A repo with 5+ SKILL.md files | Multi-skill-per-repo / per-repo cap |
| A slop repo (template name) | `isSlop` filter path |
| A high-quality featured repo | Score → tier path |

Pick these from current `skills-raw.json` (we already have the data). Commit as
`tests/fixtures/smoke-repos.json`.

### Mocked GitHub API: nock vs msw

| Library | Pros | Cons | Verdict for us |
|---------|------|------|----------------|
| **nock** | Mature, Node.js native, fixture-recording (`nockBack`) writes real responses to disk for replay. | "Doesn't support Node 18+ native fetch" (per [bam.tech writeup](https://www.bam.tech/en/article/nock-vs-msw-i-tested-both-and-here-is-what-i-learned)) — but recent versions have added support; verify. | Strong default. |
| **msw** | Network-level intercept, works across browser+node, GraphQL support, fetch-native. | Heavier setup, more useful when the same mocks are reused across env (we don't have browser tests). | Overkill for our needs. |
| **No mocks, talk to real API with seed** | Highest fidelity. No drift between mock and reality. Free against rate limit if seed is small (10 repos × few requests). | Requires GITHUB_TOKEN in test env. Slower (network). | **Recommended for smoke test.** |

**Recommendation:** Use **real-API-with-seed** for smoke (10 repos = ~30 requests, 2 min)
and use **nock with recorded fixtures** for unit tests (filter, parse, score). That gives:

- Fast unit tests (no network, deterministic).
- High-confidence integration tests (real API behavior).
- Both runnable in CI as a pre-merge gate, separate from the daily cron.

### Filter test fixtures for R3 merge

`scripts/filter.test.js` already exists per 3.0.0 PLAN.md (Task 4). Ensure it covers:

- Track 1 freshness merge with one slug match (basic case).
- No matches (loadCurrentSkillsBySlug returns empty).
- A skill in skills-raw with same id but different slug as in skills.json (the slug
  collision case from CONCERNS.md 2.1).
- A field that is `null` in current skills.json — should NOT overwrite a non-null in raw.
- A field that is `null` in raw — should be overwritten by current's non-null.

### CI dry-run / `act` viability

Per [nektos/act issues](https://github.com/nektos/act/issues/245),
**`act` cannot run scheduled (cron) workflows directly** — they're ignored at parse time.
Workaround: `act workflow_dispatch -W .github/workflows/daily-scrape.yml` to invoke
manually. Cache support is also not fully baked
([issue 1513](https://github.com/nektos/act/issues/1513)) — can configure but limited.

**Verdict on act:** Useful for "does my YAML parse and basic step plumbing work" but
NOT a substitute for a real scheduled run. Don't rely on it to catch the bugs we hit.

### Minimum-viable local validation that would have caught 3.0.0 bugs

```
npm run test:smoke   # Real API, 10-repo seed. ~2 min. Catches bugs 2 & 3.
npm run test:unit    # nock fixtures + jest/vitest. Catches bug 1 if a property test
                     #   synthesizes a big-cache scenario.
```

Plus: a **pre-merge gate workflow** that runs `test:smoke` on PRs against `main`.

The 3.0.0 plan-check correctly noted "Task 1 verify only runs node --check + import-keys
check — proves syntax, not behavior." This is exactly the gap. 3.0.1 should close it.

---

## Environment Availability

Phase 3.0.1 is config + script changes; existing CI environment is the runtime. No new
external tools required.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 20 | All scripts | ✓ in CI (`actions/setup-node@v4 with: node-version: 20`) | 20.x | — |
| GitHub PAT (`SCRAPE_PAT`) | Track 1, Track 2 | ✓ secret configured | — | None — fatal if missing |
| `gh` CLI | Bootstrap workflow | ✓ pre-installed on `ubuntu-latest` | latest | — |
| `actions/cache@v4` | Cache restore/save | ✓ official | v4 | — |
| Cloudflare creds | Deploy step | ✓ secrets configured | — | — |
| OpenAI API key | Embed step | ✓ secret configured | — | — |

No fallback required. No new dependencies introduced by 3.0.1.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None established. `scripts/filter.test.js` exists (per 3.0.0 PLAN.md Task 4) but no test runner is wired into `package.json`. |
| Config file | None — see Wave 0 |
| Quick run command | `node --test scripts/filter.test.js` (Node native test runner) |
| Full suite command | None yet — see Wave 0 |

**Recommended framework:** Node.js native test runner (`node:test`), available since
Node 18, no extra dependency. This matches the project's "minimize dependencies" ethos
(only 6 prod deps in package.json).

### Phase Requirements → Test Map

3.0.1 has no formal REQ-IDs yet (planner will assign). Probable requirements + tests:

| Probable Req | Behavior | Test Type | Automated Command | File Exists? |
|--------------|----------|-----------|-------------------|--------------|
| 3.0.1-REQ-1 | `skills-raw.json` is restored from GHA cache or release bootstrap before Track 2 | integration | `act workflow_dispatch -W daily-scrape.yml --dry-run` (verifies step exists) + manual smoke | ❌ Wave 0 |
| 3.0.1-REQ-2 | Track 2 incremental skip-known-IDs works given a populated `skills-raw.json` | unit | `node --test scripts/scrape.test.js -- --filter='skip-known'` | ❌ Wave 0 |
| 3.0.1-REQ-3 | Discovery cursor advances after successful run | unit | `node --test scripts/scrape.test.js -- --filter='cursor'` | ❌ Wave 0 |
| 3.0.1-REQ-4 | `bootstrap-skills-raw-cache.yml` workflow exists and references release asset | smoke | `gh workflow view bootstrap-skills-raw-cache.yml` + assert | ❌ Wave 0 |
| 3.0.1-REQ-5 | Filter R3 merge unaffected by 3.0.1 changes | unit | `node --test scripts/filter.test.js` | ✅ exists per 3.0.0 |
| 3.0.1-REQ-6 | streamed write of skills-raw.json doesn't crash for sub-V8-limit sizes | unit | `node --test scripts/scrape.test.js -- --filter='write-large'` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test scripts/<file>.test.js` for the file just touched.
- **Per wave merge:** `node --test scripts/` (full suite).
- **Phase gate:** Full suite green + manual `workflow_dispatch` smoke run + `gh cache list`
  shows fresh `skills-raw-` and `etag-cache-` keys.

### Wave 0 Gaps

- [ ] `scripts/scrape.test.js` — unit tests for skip-known-IDs, cursor, streamed write.
- [ ] `tests/fixtures/smoke-repos.json` — 10-repo seed corpus (Q10).
- [ ] Wire `npm test` script in `package.json` (`"test": "node --test scripts/"`).
- [ ] No framework install needed — Node native test runner.

---

## Common Pitfalls

### Pitfall 1: Assuming code-search qualifiers behave like repo-search qualifiers

**What goes wrong:** Plan applies `pushed:>3d` to `/search/code` queries. Either silently
ignored or filtering on something undocumented. Empirically, narrowing was ~5% (per
phase context), confirming the qualifier is largely no-op on code search.

**Why it happens:** GitHub's docs describe qualifiers per search-type but in scattered
locations. Easy to assume parity.

**How to avoid:** Verify each qualifier against the specific endpoint's docs (`searching-code`
vs `searching-for-repositories`). When in doubt, run a one-shot manual query both with
and without the qualifier and compare result counts.

**Warning signs:** Result count barely changes when adding date filter. Result ordering
appears non-time-sorted (because code search has no sort).

### Pitfall 2: Conflating "primary rate limit" with "secondary rate limit"

**What goes wrong:** Code that retries on 403 assuming primary-rate-limit reset, when
the 403 is from secondary limits with shorter cool-down windows.

**Why it happens:** Both surface as 403; only the `x-ratelimit-*` headers distinguish.
GitHub's docs separate them, but many client libs don't.

**How to avoid:** Always read `x-ratelimit-remaining`, `x-ratelimit-resource`, and
`retry-after` headers when getting 403. Our `github-fetch.js:96-103` reads
`x-ratelimit-reset` but does not read `x-ratelimit-resource` (which would tell us
"primary" vs "secondary" vs "code_search"). Improvement opportunity.

### Pitfall 3: V8 string limit on JSON.stringify of growing state files

**What goes wrong:** State file grows past 512 MiB serialized; JSON.stringify throws
`RangeError: Invalid string length`; cron fails silently if not caught.

**Why it happens:** Growth is gradual; works for months then suddenly doesn't.

**How to avoid:** Stream writes for any file projected to exceed 256 MiB (50% margin).
Test the projection at every corpus-growth milestone.

**Warning signs:** State file size approaches 256 MiB. CI run time variance increases
(GC pressure from large strings).

### Pitfall 4: Trusting `if: always()` for state persistence on platform timeout

**What goes wrong:** Cron fits the 6h cap with no margin; gets killed; cache save skipped;
next run is cold; same fate. We've already lived this (CONTEXT.md 4/18 incident).

**Why it happens:** `if: always()` runs on cancellation only if the runner is still alive.
The 6h platform cap force-kills the runner; post-steps don't run.

**How to avoid:** Architect to NEVER run a job that approaches 6h. Split work. Save
state mid-run, not just post-run (the existing checkpoint-every-1000 pattern, but for
cache as well as `.partial`).

**Warning signs:** Job duration is consistently >4h. `if: always()` save step shows
"queued — not started" in logs of cancelled run.

### Pitfall 5: Reading entire 295 MB skills-raw.json into a single Node string

**What goes wrong:** Today: works (under 512 MiB). At 2x corpus growth (~600 MB raw): fails
with V8 string limit. JSON.parse first reads to string, then parses.

**Why it happens:** `readFileSync` returns a string; for files near 512 MiB, the read
itself is the bottleneck.

**How to avoid:** Switch to a streaming JSON parser like `stream-json` (npm) when reading
state files >256 MB. Or: keep state in NDJSON format (line-delimited JSON) which is
trivially streamed. We already do this for skill-vectors.

**Warning signs:** Memory usage during scrape startup spikes >2 GB. RSS climbs into
ranges where the runner's 7 GB RAM matters.

---

## Code Examples

### Pattern: Streaming JSON write (current implementation, verified)

Source: `scripts/lib/github-fetch.js:133-153` (commit `82cc7ab`).

```javascript
export function saveETagCache(cache) {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  const tmp = ETAG_PATH + '.tmp';
  const fd = openSync(tmp, 'w');
  try {
    writeSync(fd, '{');
    let first = true;
    for (const [k, v] of Object.entries(cache)) {
      const chunk = (first ? '' : ',') + JSON.stringify(k) + ':' + JSON.stringify(v);
      writeSync(fd, chunk);
      first = false;
    }
    writeSync(fd, '}');
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, ETAG_PATH);
}
```

Use this pattern for `skills-raw.json` write at `scrape.js:569`.

### Pattern: GraphQL batched repo lookups (proposed for Track 1)

Source: synthesized from
[GraphQL docs](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api).

```javascript
// Batch 100 repos per GraphQL call. ~9 calls for current 826-repo corpus.
function buildBatchedRepoQuery(repos) {
  const aliases = repos.map((r, i) => {
    const [owner, name] = r.split('/');
    return `r${i}: repository(owner: "${owner}", name: "${name}") {
      stargazerCount
      forkCount
      issues(states: OPEN) { totalCount }
      pushedAt
      updatedAt
      isArchived
      repositoryTopics(first: 20) { nodes { topic { name } } }
      licenseInfo { spdxId }
      primaryLanguage { name }
      description
      defaultBranchRef { name }
    }`;
  }).join('\n');
  return `query { ${aliases} }`;
}
```

Implement only if planner has the budget; can land in 3.0.2 instead.

### Pattern: Asset-seeded cache (existing for etag, proposed for skills-raw)

Source: `.github/workflows/bootstrap-etag-cache.yml` (commit `566f83d`). Adapt for
skills-raw:

```yaml
name: Bootstrap skills-raw cache (one-shot)
on:
  workflow_dispatch: {}
jobs:
  bootstrap:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - name: Download skills-raw from release asset
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          mkdir -p data
          gh release download skills-raw-bootstrap \
            --pattern 'skills-raw.json' \
            --output data/skills-raw.json
      - name: Save to GHA cache
        uses: actions/cache/save@v4
        with:
          path: data/skills-raw.json
          key: skills-raw-bootstrap-${{ github.run_number }}
```

---

## State of the Art

| Old approach (3.0.0) | Current approach (3.0.1) | When changed | Impact |
|----------------------|--------------------------|--------------|--------|
| `pushed:>3d` qualifier on `/search/code` | Repo-search-driven discovery cursor | Q3b empirical: code search doesn't support pushed qualifier | Discovery becomes truly incremental, not "incremental in name only" |
| `skills-raw.json` not on CI runner | `skills-raw.json` in GHA cache + release-asset bootstrap | Q1 + Q6: mirror proven etag pattern | Skip-known-IDs works on every run after first |
| Implicit assumption: GHA cache 10 GB cap | Explicit: cache can exceed 10 GB since Nov 2025; eviction is LRU + 7-day inactive | Nov 20, 2025 GitHub changelog | Headroom for state growth at Phase 3.0 corpus 2x |
| `if: always()` save protects against all cancellations | `if: always()` save protects against soft cancel; **NOT** platform 6h cap | Empirical, 2026-04-18 | Architect for sub-6h runs, not "use the 6h budget" |
| Track 1 = N REST `GET /repos/X` | (proposed) Track 1 = N/100 GraphQL batched queries | Phase 3.0.x adoption decision | 100x reduction in request count for metadata refresh |

**Deprecated/outdated (in 3.0.0 or earlier docs):**
- `actions/cache@v3` ([deprecated](https://github.blog/changelog/2025-09-29-new-date-for-enforcement-of-cache-eviction-policy/)) — daily-scrape uses v4, good.
- "10 GB cache limit per repo" (CLAUDE.md and 3.0.0 plan) — outdated since 2025-11-20.
- "skills-raw.json is ~8 MB" (CLAUDE.md, ARCHITECTURE.md before commit `01e5f4e`) — was off by 30x; corrected to ~295 MB.

---

## Open Questions

1. **Does `pushed:>` truly do nothing on code search, or is it doing something
   undocumented?**
   - What we know: docs don't list it as supported.
   - What's unclear: GitHub may ignore it, parse-error it, or apply a soft filter.
   - Recommendation: 5-minute manual experiment — run `q=filename:SKILL.md size:<500`
     vs `q=filename:SKILL.md size:<500 pushed:>2026-04-22` and compare counts. If
     identical, confirmed ignored. The planner can include this as a Wave-0 spike.

2. **Does GraphQL batched repo query actually cost ~1-2 points for 100-repo aliases of
   shallow fields?**
   - What we know: cost is "complex," shallow fields are cheap.
   - What's unclear: the exact point cost. The `rateLimit { cost remaining }` field
     can be queried in the same GraphQL request to learn the answer empirically.
   - Recommendation: 10-minute spike during Wave 0. If cost is >50 points/100-repos,
     reconsider.

3. **What's the right corpus-size threshold to switch to streaming JSON parse for
   `skills-raw.json`?**
   - What we know: V8 string limit is 512 MiB; today's file is 295 MB.
   - What's unclear: the JSON.parse memory multiplier (string + parsed object trees).
   - Recommendation: monitor actual RSS during Track 2 startup over next 30 days.
     Switch to `stream-json` when steady-state RSS at parse exceeds ~2 GB. Out of
     3.0.1 scope; flag for 3.0.x.

4. **Is the `data/discovery-cursor.json` cursor truly resilient to `pushed_at` precision
   collisions?**
   - What we know: GitHub returns `pushed_at` in ISO 8601 with second precision.
   - What's unclear: behavior when a `pushed:>2026-04-25T06:30:00Z` filter aligns
     exactly with a repo's `pushed_at`. Likely the strict `>` excludes equal — but
     could be off-by-one risk.
   - Recommendation: subtract a 1-second buffer when advancing the cursor (cursor
     `T-1s` instead of cursor `T`). Mild over-fetch is harmless; under-fetch is data loss.

5. **Will the GH Archive BigQuery alternative scale better than discovery-cursor at
   Phase 3.0 corpus 2-3x?**
   - What we know: GH Archive is hourly, free 1 TB/mo on BigQuery, surgical query.
   - What's unclear: integration cost (new credentials, new client lib, new failure
     mode).
   - Recommendation: defer until 3.0.x. If discovery-cursor proves insufficient, this
     is the documented next-step lever. NOT for 3.0.1.

---

## Sources

### Primary (HIGH confidence — official GitHub/V8/Cloudflare docs)

- [GitHub REST API rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api) — primary/secondary distinction, code-search 10/min, search 30/min, primary 5000/hr.
- [GitHub REST API best practices (conditional requests)](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api) — 304 responses do not count against primary rate limit.
- [GitHub GraphQL rate limits and query limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api) — point system, 5000 points/hr, 2000 points/min secondary, batched query cost model, 1-100 first/last, 500k node max.
- [GitHub searching code docs](https://github.com/github/docs/blob/main/content/search-github/searching-on-github/searching-code.md) — code search supported qualifiers, no `created:`, no `sort:`.
- [GitHub sorting search results](https://docs.github.com/en/search-github/searching-on-github/sorting-search-results) — sort options for search.
- [GitHub Actions cache size changelog (2025-11-20)](https://github.blog/changelog/2025-11-20-github-actions-cache-size-can-now-exceed-10-gb-per-repository/) — 10 GB cap removed.
- [GitHub Actions dependency caching](https://docs.github.com/en/actions/reference/workflows-and-actions/dependency-caching) — restore-keys prefix match, eviction policy, 7-day inactive.
- [GitHub Actions limits](https://docs.github.com/en/actions/reference/limits) — 6h job cap, 72h workflow cap.
- [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) — 14 GB disk, 7 GB RAM ubuntu-latest.
- [GitHub Releases storage and bandwidth](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases) — 2 GiB asset limit, no bandwidth cap.
- [GitHub workflow cancellation reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-cancellation) — SIGINT 7.5s + SIGTERM 2.5s + kill, post-step `if: always()` semantics.
- [GitHub repository redirect API gist (jasonrudolph)](https://gist.github.com/jasonrudolph/56388a4ff51b4f721cac) — 301 redirect for renamed repos.
- [Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing/) — 10 GB storage, 1M Class A, 10M Class B, zero egress.
- [V8 maximum string length issue 6148](https://bugs.chromium.org/p/v8/issues/detail?id=6148) — 512 MiB string limit on 64-bit V8.
- [Node.js issue 13465 (string length on JSON write)](https://github.com/nodejs/node/issues/13465) — practical implications of V8 string limit.
- [GHArchive](https://www.gharchive.org/) — hourly GitHub event stream, BigQuery public dataset.
- [pkgsite design](https://github.com/golang/pkgsite/blob/master/doc/design.md) — pkg.go.dev architecture, index/proxy/worker split.
- [deps.dev BigQuery dataset docs](https://docs.deps.dev/bigquery/v1/index.html) — snapshot model.

### Secondary (MEDIUM confidence — community + verified blog)

- [Maximum String Length Across Node.js Versions (philz.dev)](https://blog.philz.dev/blog/node-string-length/) — verified V8 limit values per Node version.
- [Nock vs MSW comparison (bam.tech)](https://www.bam.tech/en/article/nock-vs-msw-i-tested-both-and-here-is-what-i-learned) — practical fixture vs intercept tradeoffs.
- [PyGithub issue 824 (1000-result cap)](https://github.com/PyGithub/PyGithub/issues/824) — confirms hard cap on search.
- [Endor Labs GitHub API rate limits guide](https://www.endorlabs.com/learn/how-to-get-the-most-out-of-github-api-rate-limits) — practical cross-reference for primary/secondary.
- [Community discussion 150900 (6h auto-cancel)](https://github.com/orgs/community/discussions/150900) — empirical confirmation of platform cap behavior.
- [actions/runner issue 987 (post-step on failure)](https://github.com/actions/runner/issues/987) — post-step `if: always()` semantics.
- [nektos/act issue 245 (scheduled workflows ignored)](https://github.com/nektos/act/issues/245) — local cron unsupported.
- [nektos/act issue 1513 (cache support)](https://github.com/nektos/act/issues/1513) — local cache limited.
- [awesome-trending-repos writeup](https://dev.to/furkankoykiran/awesome-trending-repos-auto-tracking-github-trending-1afj) — industry-standard hobby-budget GHA scraper pattern.
- [Apify GitHub list scraper](https://apify.com/janbuchar/github-list-scraper) — date-partitioning workaround for 1000 cap.

### Tertiary (LOW confidence — flagged for verification)

- libraries.io architecture details — search returned generic Postgres-queue patterns,
  not libraries.io–specific docs. **Not used as basis for design recommendations.**
- Generic "PostgreSQL job queue" patterns — interesting but not transferable to GHA.
- Behavior of `pushed:>` on `/search/code` (silent ignore vs filter): inferred from
  empirical 5% narrowing, not docs-confirmed.

---

## Synthesis (read this first)

The ten findings the planner should weight most heavily, in priority order:

1. **The 3.0.0 design assumed `pushed:>` works on `/search/code`. It doesn't.** This is
   the empirical "barely 5% narrowing" already observed. Replace incremental code
   search with **`/search/repositories?pushed:>${cursor}` + tree walk for SKILL.md**.
   Keep weekly full code search as the long-tail safety net. (Q3b, Q8c)

2. **`skills-raw.json` (295 MB) needs a durable home that isn't the repo.** Option (e):
   GHA cache + release-asset bootstrap, mirroring the proven `etag-cache-bootstrap`
   pattern from commit `566f83d`. The 3.0.0 plan-check's option (d) ("don't persist")
   leaves Track 2 incremental with no skip baseline and lands us back in rate-limit
   hell. (Q1, Q6)

3. **GHA cache size cap was REMOVED on 2025-11-20.** Old assumption "10 GB total per
   repo" is obsolete. Eviction is now LRU + 7-day inactive; size is uncapped (with
   billing for usage above the configured limit). This is significant headroom for
   state growth. (Q4)

4. **304 responses don't count against the primary REST rate limit.** ETag cache is
   even more valuable than 3.0.0 assumed. Track 1's per-repo metadata loop is
   essentially free against the 5000/hr budget when the cache is warm. Budget pressure
   is entirely on search and content fetches. (Q3a)

5. **Track 1 should migrate to GraphQL batched repo queries (100-aliases-per-call).**
   Reduces ~826 REST calls to ~9 GraphQL calls; reduces ~20k REST calls (Phase 3.0
   future) to ~200. Same point budget, much faster, more headroom. Orthogonal to the
   discovery fix; can land separately. (Q3d)

6. **`if: always()` does NOT survive the GitHub PLATFORM 6h cap.** Architect to NEVER
   run a job that approaches 6h. The 6h cap force-kills the runner; post-steps are
   skipped. This was the empirical 4/18 incident. The split-track architecture already
   addresses this for daily runs; weekly Sunday full sweep at 7h timeout is "expected
   to be killed" per current weekly-discover.yml — that's fine because state persists
   in cache via mid-run checkpoints. (Q4, Q7)

7. **The asset-seeded cache pattern (release asset → workflow_dispatch → cache save)
   is rare enough to not have a community name.** Suggest formalizing it as the
   project's standard recovery pattern for any state file >50 MB. Same workflow shape
   for skills-raw.json that already exists for etag-cache.json. (Q6)

8. **V8 512 MiB string limit is a hard ceiling for `JSON.stringify` and `JSON.parse`.**
   Current state files are below it but `skills-raw.json` at 295 MB is on the trajectory
   to breach at Phase 3.0 corpus 2-3x. Stream the write path (already done for
   etag-cache; needs replication). Stream the read path when steady-state corpus crosses
   ~600 MB raw. (Q5)

9. **Test strategy gap that allowed all three 3.0.0 CI bugs:** no smoke test, no fresh-
   checkout test, no rate-limit injection. Minimum-viable fix:
   `node --test scripts/` runner + 10-repo seed corpus + a fresh-checkout pre-merge
   GitHub Action. Native Node test runner means zero new dependencies. (Q10)

10. **GH Archive (BigQuery, 1 TB/mo free) is the lever to pull when discovery-cursor
    saturates.** Surgical "repos that pushed a SKILL.md change in last 24h" query
    bypasses GitHub Search API entirely. NOT for 3.0.1 (adds infra surface), but the
    planner should know it exists for 3.0.x or Phase 3.x. (Q2, Q8e)

---

## Metadata

**Confidence breakdown:**
- State-persistence allocation (Q1): HIGH — based on verified file sizes + verified GitHub limits.
- Real-world architectures (Q2): MEDIUM — pkg.go.dev/deps.dev/GHArchive verified via official docs; libraries.io specifics LOW.
- API edge cases (Q3): HIGH on supported qualifiers; MEDIUM on `pushed:>` ignored-on-code-search (inferred from empirical + docs absence).
- GHA cache mechanics (Q4): HIGH — official docs + recent changelog.
- V8 limits (Q5): HIGH — primary V8 + Node sources.
- Bootstrap pattern (Q6): HIGH on what it does; MEDIUM on whether it's the canonical solution.
- Failure modes (Q7): MEDIUM — extrapolated from observed 3.0.0 behavior.
- Discovery strategy (Q8): MEDIUM — primary recommendation (cursor) is novel-enough that empirical validation is needed in Wave 0 spike.
- Skip-known-IDs (Q9): HIGH — concrete and well-bounded.
- Test strategy (Q10): HIGH — Node native test runner is well-understood.

**Research date:** 2026-04-25
**Valid until:** 2026-05-25 (30 days; GitHub Actions evolves and docs change). Re-verify
GraphQL point costs and 304-against-secondary-limits behavior if those become load-bearing.
