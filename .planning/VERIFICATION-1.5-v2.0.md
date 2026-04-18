# Verification: Phase 1.5 + v2.0 Agent-Native Directory

**Audit date:** 2026-04-14
**Scope:** Phase 1.5 (phases 01-06 + 01.5.1) and Milestone v2.0 (phase 02.1 + orphaned 2.2-2.5 + 1.5.2)
**Method:** Cross-phase integration + E2E flow trace; trusted priors from .planning/codebase/CONCERNS.md and .planning/codebase/ARCHITECTURE.md, spot-checked against live source.

---

## Section 1: Per-requirement verdict table

| ID | Claim | Status | Notes |
|----|-------|--------|-------|
| UX-01 | Hero renders 33,078/1,078/305 from pipeline-stats.json | PARTIAL | data/pipeline-stats.json:3 has total_discovered=33000 rounded. Rendered today: 33,000+ / 1,078 / 305. Wired end-to-end. Cosmetic drift. |
| UX-02 | Sticky header search | PASS | src/pages/index.astro:32 search-bar div sticky top-[57px] z-40. Clear button L46. |
| UX-03 | Query hides Featured + expands grid to all skills | PASS | index.astro:17-18 renders full catalog; showSearchingState() L215 hides featured/ecosystem/browse-more. |
| UX-04 | Featured skills appear in search results | PASS | All skills rendered as .skill-item; itemsBySlug L183-186 covers every skill. |
| DATA-01 | skill_first_commit_at on every skill | PASS | 1078/1078 populated. backfill-skill-birth-dates.js one-shot, not in CI. |
| DATA-02 | New-skills-per-week chart | PASS | index.astro:21,113 -> buildNewSkillsWeekChart. charts.js:53,71 uses birth dates. |
| DATA-03 | Active-maintenance chart | PASS | index.astro:22,123 -> buildMaintenanceChart. charts.js:131. |
| DATA-04 | star-history.json for top 305 Featured | PASS | 45 MB committed; consumed by generate-badges.js:33. |
| DIST-01 | Tier-badge SVG per skill | PASS | public/badge/ has 2,144 SVGs. Prebuild generate-badges.js. |
| DIST-02 | -history.svg endpoint | PASS external / UNWIRED on-site | 1,072 exist; grep star-history in src/ = 0. Intent embed-only. |
| CREATOR-01 | /creators/[username] profile pages | PASS | Exists; bios fall back to repo_description; GitHub user-bio fetch deferred. |
| CREATOR-02 | /creators four leaderboards | PASS | getCreatorLeaderboards(10) - byFeatured/prolific/quality/rising. |
| CREATOR-03 | Prolific/Quality/Rising badges | PASS | skills.js:199-204. |
| 1.5.1 | /creators/all/ table | PASS | creators/all.astro + getCreatorsForBrowse. |
| ANALYTICS-01 | Cloudflare Web Analytics | PASS no-op | BaseLayout.astro:10 automatic CF-dashboard setup. |
| ANALYTICS-02 | PostHog six events | PASS code | analytics.js:24-54; BaseLayout.astro:36; events at L97-134 + CopyButton.astro:36. |
| ANALYTICS-03 | Search log to D1 | PASS | worker/index.js:72,294-307; daily-salted IP hash. |
| INFRA-01 | /skills-registry.json | PASS | count=1078, skills.length=1078. |
| INFRA-02 | llms.txt documentation | PASS | public/llms.txt linked from BaseLayout.astro:32. |
| v2.0 2.1 | /api/v1/search + homepage wired | PASS | worker/index.js:188; homepage index.astro:242 calls it. |
| v2.0 2.2 | KV cache active | FAIL | wrangler.toml:44-46 binding FULLY COMMENTED OUT. Every query pays ~1.1s OpenAI tax. |
| v2.0 2.3 | Similar-skills on detail pages | PASS | skills/[...slug].astro:28 -> getSimilarSkills. compute-similar.js in prebuild. |
| v2.0 2.4 | marketplace.json 193 plugins | PASS | .claude-plugin/marketplace.json plugins=193. |
| v2.0 2.5 | Clusters data | PARTIAL orphaned | data/skill-clusters.json committed but NOT in src/ and NOT in prebuild. Will stale. |
| v2.0 1.5.2 | Slug collision fix | FAIL open | 6 duplicate slugs live: microsoft/azure-aigateway, quickwit-oss/simple-pr, resend/resend-cli, laravel/configure-nightwatch, lllooollpp/mijia-control, auth0/auth0-android. filter.js:587 path-unaware. |

### Additional notes

- Daily history snapshots: only data/history/2026-04-11.json exists. 4/12-4/14 missing. Fix f7d293d; first real verification 2026-04-15 06:30 UTC.
- STATE.md says Phase 1 of 6, Progress 0% despite 14 completed phases.


---

## Section 2: Cross-phase integration test - User discovers a Featured skill via semantic search

Trace:

1. User lands on / (src/pages/index.astro). BaseLayout renders pipeline stats (UX-01). OK.
2. User types into sticky search (UX-02). Listener index.astro:311-328. PostHog search_query via BaseLayout.astro:134 (ANALYTICS-02). After 400ms debounce runSemanticSearch(val) index.astro:232.
3. Browser fetches /api/v1/search?q=...&k=30. Hits Worker worker/index.js:335 -> semanticSearch L188. Query embedded via OpenAI. KV cache path commented out at wrangler.toml:44-46 so every request pays full OpenAI round trip. Vectorize query L259. Dedup by slug L269-277 papers over slug collision bug. Fire-and-forget D1 log L294-307 (ANALYTICS-03).
4. Worker returns results.
5. Client reorders DOM: index.astro:257-279 hides non-matches, reattaches matches. Featured skills (UX-04) appear.
6. User clicks result -> /skills/{slug}/. Static page from skills/[...slug].astro. Similar skills via getSimilarSkills(skill,5) L28 (Phase 2.3). Integration chips via getSkillIntegrations. PostHog view_skill_detail fires.

Verdict: flow works end-to-end. Caveats:
- Latency degraded (~1.1s) because KV cache inactive.
- Slug collisions can send users to wrong twin page (6 skill pairs). No crash; invisible data loss.

---

## Section 3: Milestone closure verdict

### YELLOW - close with known gaps

Every user-facing flow in 1.5 and v2.0 works end-to-end. Hero, search, charts, badges, creator pages, registry, marketplace, semantic search, similar-skills are wired and observable. Closure is defensible.

But three roadmap [x] marks are misleading, one open bug is confirmed live, and the moat feeder is freshly broken:

1. Phase 2.2 KV cache: [x], code ships, binding commented out.
2. Phase 2.5 clusters: [x] with visual-page-deferred - accurate for the page, but the data-generation script is orphaned from prebuild and will stale.
3. Phase 1.5.2 slug collisions: [ ]; 6 collisions verified today.
4. Daily cron broken 4/12-4/14; fix committed, awaits first green run 2026-04-15 06:30 UTC. Phase 3.0 cannot kick off while its feeder is untrusted.
5. STATE.md stale by 14 phases.

None crash the site. All hurt Phase 3.0 if ignored.


---

## Section 4: Recommended cleanup items

| # | Item | Severity | Effort | Blocks 3.0? | Rolls into |
|---|------|----------|--------|-------------|------------|
| 1 | Verify 2026-04-15 cron produces data/history/2026-04-15.json | Blocker | 0 (watch) | YES | Pre-3.0 gate |
| 2 | Update STATE.md to reflect completed phases | Cosmetic/high | 5 min | YES (next session reads it) | Pre-3.0 gate |
| 3 | Activate Phase 2.2 KV namespace + uncomment wrangler.toml:44-46 | Gap | 5 min + redeploy | No; closes [x] lie | Pre-3.0 cleanup |
| 4 | Decide data/plugins-raw.json tracking policy | Gap | 10 min | YES - Phase 3.0 spec uses it | Phase 3.1 |
| 5 | Phase 1.5.2 slug collision fix in scripts/filter.js:587 | Gap | 1-2 hrs | Phase 3.0 amplifies | Phase 3.2-3.3 filter overhaul |
| 6 | Wire compute-clusters.js into prebuild OR delete | Gap | 1-5 min | No | Phase 3.0 decision |
| 7 | Add scripts/*.log glob + stale .partial to .gitignore | Cosmetic | 2 min | No | Backlog |
| 8 | Resolve uncommitted scripts/scrape-plugins.js change | Unknown | 5 min (ask user) | Maybe | Pre-3.0 intake |
| 9 | PHASE-1.5-SCOPE.md Pagefind reference cleanup | Cosmetic | 2 min | No | Backlog |
| 10 | Cron-failure external webhook alert | Operational | 30 min | No | Phase 3.x ops |
| 11 | Star-history incremental refresh for new Featured | Gap | 2-4 hrs | No | Phase 4+ |
| 12 | Embed star-history SVG on detail pages | Side-quest | 30 min | No | Optional |
| 13 | Annotate backfill scripts in scripts/README.md | Cosmetic | 10 min | No | Backlog |

### Mandatory gates before Phase 3.0 plan-milestone
Items 1, 2, 3, 4, 8 - roughly 30 min of work plus one external cron verification. Pre-3.0 housekeeping PR, not a full new phase.

### Should-fix-in-Phase-3.0-scope
Item 5 (slug collision) belongs inside the Phase 3.0 filter overhaul. Item 6 (clusters wiring or delete) is a 1-min decision at kick-off.


### Requirements Integration Map

| Requirement | Integration Path | Status | Issue |
|-------------|-----------------|--------|-------|
| UX-01 | pipeline-stats.json -> skills.js:96 getPipelineStats -> index.astro:68 + BaseLayout.astro:6,147 | WIRED | 33,000 vs doc 33,078 cosmetic drift |
| UX-02/03/04 | skills.json -> skills.js -> index.astro + JS -> /api/v1/search -> worker -> Vectorize | WIRED | Substring fallback preserved |
| DATA-01 | backfill-skill-birth-dates.js -> skill_first_commit_at -> skills.js/charts.js/getCreators | WIRED | One-shot; no auto-backfill for new skills |
| DATA-02/03 | skills.json -> charts.js -> index.astro | WIRED | - |
| DATA-04 | backfill-star-history.js -> star-history.json -> generate-badges.js | PARTIAL | No on-site consumer (intent external embed) |
| DIST-01 | prebuild generate-badges.js -> public/badge/*/*.svg | WIRED | - |
| DIST-02 | star-history.json -> generate-badges.js -> -history.svg | WIRED external / UNWIRED on-site | - |
| CREATOR-01/02/03 | skills.json -> getCreators/getCreatorLeaderboards -> creators/*.astro | WIRED | GitHub user-bio fetch deferred |
| 1.5.1 | getCreatorsForBrowse -> creators/all.astro | WIRED | - |
| ANALYTICS-01 | Cloudflare dashboard (no code) | EXTERNAL | Cannot verify from repo |
| ANALYTICS-02 | PUBLIC_POSTHOG_KEY -> analytics.js -> BaseLayout.astro | WIRED | Key-gated |
| ANALYTICS-03 | Search input -> /api/log-search or inline /api/v1/search -> D1 | WIRED | - |
| INFRA-01/02 | prebuild generate-registry.js -> public/skills-registry.json; llms.txt linked in head | WIRED | - |
| v2.0 2.1 | embed-skills + upload-vectors -> Vectorize; worker semanticSearch -> index.astro | WIRED | - |
| v2.0 2.2 | worker/index.js:139-183 KV code  vs  wrangler.toml:44-46 binding | UNWIRED | Binding commented out |
| v2.0 2.3 | compute-similar.js (prebuild) -> similar-skills.json -> skills.js:334 -> skills/[...slug].astro:28 | WIRED | - |
| v2.0 2.4 | generate-marketplace.js (prebuild) -> .claude-plugin/marketplace.json | WIRED | 193 plugins |
| v2.0 2.5 | compute-clusters.js -> data/skill-clusters.json -> (no consumer) | UNWIRED | Not in prebuild; stale |
| v2.0 1.5.2 | filter.js:587 single-source; downstream dedupes in 4 places | PARTIAL | 6 live collisions; URLs hide one twin |

Requirements with no cross-phase wiring: None - every requirement has at least a data -> consumer path. Unwired items (2.2, 2.5) are within-phase wiring gaps, not cross-phase ones.

---

*Integration audit complete.*
