---
gsd_state_version: 1.0
milestone: v4.0
milestone_name: — Data Feeds
status: Phase 4.1 COMPLETE — verified 14/14; next 4.2 API harvest v1
stopped_at: "Phase 4.1 COMPLETE 2026-11-04 on feat/v4.0-data-feeds (unmerged). Next: /gsd:discuss-phase 4.2 or /gsd:plan-phase 4.2 (API harvest v1)."
last_updated: "2026-11-05T02:24:06.761Z"
last_activity: 2026-11-05
progress:
  total_phases: 8
  completed_phases: 1
  total_plans: 8
  completed_plans: 8
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (last updated 2026-04-10)

**Core value:** Users can find the best Claude skill for a given task in under 30 seconds, with visible signals for why it's trustworthy.
**Current focus:** v4.0 Data Feeds — Phase 4.1 complete (verified); Phase 4.2 API harvest v1 is next. Branch feat/v4.0-data-feeds, not merged. Daily cron still failing since 2026-09-28 (separate fix session proposed).
**Milestone:** v3.0 — Comprehensive Agent Tooling Index (in progress)

## Current Position

Phase: 4.1 (envelope-generalization) — ✅ COMPLETE 2026-11-04, VERIFICATION passed 14/14
Plan: 8 of 8
Next: **Phase 4.2 — API harvest v1** (APIs.guru + data.gouv.fr + UK catalogue + public-apis mirror; see docs/PHASE-4.0-SPEC.md). v3.0 phases 3.5–3.9 remain open on main.

**Remaining v3.0 phases (all 1-3h; see PHASE-3.0-SPEC.md):**

- **3.5** Homepage + nav redesign (Top Skills / Top Plugins sections, mixed search + type chips) — frontend
- **3.6** Tier rename Featured→Top across codebase + UX — cross-cutting (do solo/first; conflicts with UI phases)
- **3.7** Pipeline integration (cron handles both scrapes/embeds/registries) — **largely subsumed by 3.2+3.4**; residual likely just registries + verification
- **3.8** Cross-entity enrichment (creator profiles show plugins, API graph includes plugins, mixed search) — backend + some frontend
- **3.9** `/trends` page (surface rising/new from compounding snapshot data) — frontend, isolated

**Parallelization note (discussed 2026-06-15):** sequence 3.6 first (solo), then 2 worktrees — UX stream (3.5→3.9) + data stream (3.7→3.8); seams = nav links + mixed-search render (assign to UX stream). GSD `/gsd:new-workspace` + `/gsd:workstreams` for isolation.

**Operational notes for 3.4 maintenance:**

- Steady-state daily cron ~2.5h (daily GraphQL refresh of ~7,339 repos ~35m is the recurring cost — future optimization candidate).
- GHA cache is branch-scoped: a steady-state measurement branch can't see a stamped cache from another branch (restores unstamped bootstrap → one-time cold backfill ~324 min, still < 360). `weekly-plugin-rewalk.yml` seeds the stamped cache on main.
- Re-disable: `PLUGINS_ENABLED='false'` (daily-scrape.yml line ~80).

Last activity: 2026-11-05

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 260603-bug | Add agent-ping affordance endpoint + llms.txt invitation | 2026-06-03 | 098124f | Live (deployed + smoke-verified) | [260603-bug-add-agent-ping-affordance-endpoint-llms-](./quick/260603-bug-add-agent-ping-affordance-endpoint-llms-/) |
| 260603-e96 | Fix failing daily-scrape Track 1 star pulse (retry-after stopgap + GraphQL batch migration) | 2026-06-03 | 921be94 | Needs Review (branch-CI dispatch) | [260603-e96-fix-failing-daily-scrape-track-1-star-pu](./quick/260603-e96-fix-failing-daily-scrape-track-1-star-pu/) |
| 260617-heq | Add Skills \| Plugins \| MCP entity links to top + footer nav | 2026-06-17 | c505106 | Done (deploying) | [260617-heq-add-skills-plugins-mcp-entity-links-to-t](./quick/260617-heq-add-skills-plugins-mcp-entity-links-to-t/) |
| 260621-cvm | Badge → Worker route migration (deletes ~18k static badge files; unblocks the assets-upload 504) | 2026-06-21 | 0d5670c | LIVE (deployed 2026-06-23 run 28049807536 in 9m33s — no 504; edge smoke all 200s incl. multi-segment + unknown-slug; byte-diff zero. wrangler dev unrunnable on win32-arm64 — verified via direct handler smoke instead) | [260621-cvm-implement-the-badge-to-worker-route-migr](./quick/260621-cvm-implement-the-badge-to-worker-route-migr/) |
| 260624-nhk | Harden upload-vectors.js against malformed vectors (fix 4-day cron freeze at "Upload vectors to Vectorize"; site stale since 6-18) | 2026-06-24 | f5c6f85 | Verified (10/10 unit tests, check:patterns clean, dry-run on real data exit 0). Pre-validate drop NaN/wrong-dim/empty-id + 4xx bisection + exit-0 on partial skip / exit-1 on ≥50% or auth. AWAITING a full cron run to carry it through to a fresh deploy. | [260624-nhk-make-upload-vectors-js-resilient-to-malf](./quick/260624-nhk-make-upload-vectors-js-resilient-to-malf/) |
| 260804-d5p | Add versioned catalog-composition snapshots (data/snapshots/) for AEO trend content — Step 1 of the post-telemetry AEO/reliability sequence | 2026-08-04 | 8c5d211 | Verified (9/9 tests, check:patterns clean); payload complete after 1 gap-close (tiers, by_entity_type, by_category, new_last_7d, maintenance active/abandoned, unique_creators, churn). Purely additive; step gated non-push, commits data/snapshots/<date>.json. First real snapshot lands on next scheduled/dispatched run. Local dry-run: 26,707 records (23,047 skill / 3,584 plugin / 76 mcp). | [260804-d5p-add-versioned-catalog-composition-snapsh](./quick/260804-d5p-add-versioned-catalog-composition-snapsh/) |
| 260804-dy2 | Harden daily-scrape reliability: (A) fix embed drift-guard false-positive [root cause of the 7-17→7-24 freeze]; (B) cron-failure alerting (GitHub issue + optional ALERT_WEBHOOK_URL push) — Step 1 continued | 2026-08-04 | ab0a818 | Verified (6/6; embed tests 4/4, check:patterns clean, success-path byte-for-byte additive +63/-0). FIX A: drift decision now on prior-overlap (matchedFromPrior/priorCount<0.5 AND priorCount≥50), not overall hit-rate → catalog growth / evicted cache no longer false-trips. FIX B: notify-on-failure job (needs+if:failure), deduped cron-failure issue, webhook gated in-script (no secrets-in-if). NEXT: turns the next silent freeze into a same-day signal — add ALERT_WEBHOOK_URL secret for phone push. | [260804-dy2-harden-daily-scrape-fix-embed-drift-guar](./quick/260804-dy2-harden-daily-scrape-fix-embed-drift-guar/) |
| 260804-eh7 | Step 2 (ranking credibility): per-repo diversity cap on homepage Featured shelf (1/repo) + top-N grid (2/repo) — fixes rtk-ai sweeping all 6 Featured slots. Selection-only, no scoring change. | 2026-08-04 | PR #17 | **PR OPEN — awaiting Dan's review, NOT merged to main** (staged per Dan's instruction; reshapes homepage). 8/8 tests, npm run build success, check:patterns clean; before/after 4→6 distinct Featured repos. PR body includes the deeper star-dampening proposal (score.js repo-star-per-skill inflation) as a calibration-sensitive follow-up needing live-catalog before/after. https://github.com/dwalshx/ClaudeAtlas/pull/17 | [260804-eh7-per-repo-diversity-cap-on-homepage-featu](./quick/260804-eh7-per-repo-diversity-cap-on-homepage-featu/) |
| 260806-dn3 | Wave 1 agent-analytics: E1 request_log D1 logging + classifier v0 (never-default-to-human) + E5 Web Bot Auth log-only Ed25519 verify + E7 agent-ping 410 retirement; run_worker_first→true (full ~98k req/day visibility) | 2026-08-06 | 2c53c6c, 7023ac7, 0bee219 | Executed on worktree branch — awaiting orchestrator merge+push+post-deploy curls. 48 worker tests green (real Ed25519 round-trip incl.), check:patterns clean. DEVIATION: .env CF_API_TOKEN lacks D1 Edit (7500 on real DDL) → request_log LAZY SELF-MIGRATES via the worker's own env.DB on first insert (apply-d1-schema.js kept for a future D1-Edit token). Drive-by root-cause fix: search_events insert was a detached promise canceled at response return (only 3 rows ever) → now ctx.waitUntil. | [260806-dn3-wave-1-agent-analytics-e1-request-loggin](./quick/260806-dn3-wave-1-agent-analytics-e1-request-loggin/) |
| 260806-ejd | Wave 2 agent-analytics: E2 markdown content negotiation (skill pages + /index.md from SKILLS_KV, explicit-Accept-only, no .md siblings) + E3 /agent/index.json token handshake (agent_token 19th request_log column via lazy ALTER TABLE, token_echo classifier rule 0 at 0.95, adverts in markdown preamble/BaseLayout head/llms.txt) | 2026-08-06 | 940dd95, a95dfac, 9a04db5, a2143ed, 88c1065 | Executed on worktree branch — awaiting orchestrator merge+push+post-deploy curls (markdown Accept round-trips, token→D1 row). 290 tests pass (75 worker, +27 new), 2 known embed-skills fails unchanged, check:patterns clean. All markdown branches try/caught → fall through to HTML on any error; Vary: Accept on both renditions; robots.txt untouched. E2 metric readable day 1; E3 gate 60-day (≥5% bot sessions echo, ≥10 clients). | [260806-ejd-wave-2-agent-analytics-e2-markdown-conte](./quick/260806-ejd-wave-2-agent-analytics-e2-markdown-conte/) |
| 260806-f00 | Wave 3 agent-analytics: E4 MCP front door (POST /mcp stateless JSON-RPC 2.0, 3 tools reusing semanticSearch/SKILLS_KV; /.well-known/mcp/server-card.json; classify rule 0.5 agent/mcp/0.95; request_log.mcp_client 20th column via generalized COLUMN_MIGRATIONS lazy ALTER; mcp/server.json registry manifest) + E6 attribution-convention spec draft (docs only) | 2026-08-09 | c4d7e27, 6d4c644, 4f0e9c7 | Executed on worktree branch — awaiting orchestrator merge+push+post-deploy smoke (initialize + tools/call curls, server card, D1 classifier_method='mcp' rows). 334 tests, 326 pass, only the 2 known embed-skills fails; check:patterns clean. Marker headers x-ca-mcp/x-ca-mcp-client are the response→waitUntil-logger channel; -32700/-32600 paths unmarked (garbage never classifies agent). Registry publish DEFERRED to Dan (domain verification + mcp-publisher). Known: country NULL on MCP-originated search_events rows (internal Request lacks cf). Session split 08-06→08-09 (limit); Wave-2 baseline fast-forward-merged before start. | [260806-f00-wave-3-agent-analytics-e4-mcp-front-door](./quick/260806-f00-wave-3-agent-analytics-e4-mcp-front-door/) |
| 260908-045 | Reciprocal Pass v1 — declared-UA good agent: pure probe module + polite runner (robots-first, 3s/host, GET-only) + 27-target dataset/report + public /bot transparency page | 2026-09-08 | 6cf6ef1, 03f59fb, c09d302 | Executed on main, NOT pushed — orchestrator to review/merge/deploy, then curl /bot/ and decide on the official post-deploy re-run. 25/25 new tests, 441/444 suite (2 known embed fails), check:patterns clean, build green (15,208 pages). Full pass: 27 targets, 0 errors, block_rate 11.5%, md-neg 7.7%, 8 llms.txt, 2 Web Bot Auth signers (ahrefs, meta), control_passes=true. 7 open questions for Dan in SUMMARY. | [260908-045-reciprocal-pass-v1-declared-ua-good-agen](./quick/260908-045-reciprocal-pass-v1-declared-ua-good-agen/) |
| 260910-fast | Reciprocal Pass v1 follow-up: /bot + report reworded "declared bot" (not AI agent); rebased onto cron, pushed, deploy green, /bot live (200); official post-deploy pass committed — 27/27 answered, block_rate 18.5% (amazon 503 + openai 403 challenges appeared vs run 1; ovhcloud robots now resolves), md-neg 7.4%, 8 llms.txt, 2 signers, control_passes=true. Run-to-run variance noted as a v3 longitudinal argument; size-based cloaking flag is noisy (6 hits, mostly dynamic-size). | 2026-09-10 | (see git log) | [260908-045-reciprocal-pass-v1-declared-ua-good-agen](./quick/260908-045-reciprocal-pass-v1-declared-ua-good-agen/) |
| 260910-g0f | Reciprocal Pass v1.1 — targets 27→157 across 13 question-keyed tiers (incl. 77-domain AEO `citation` tier; 87 `cited`), report gains tier order + question column, Cited cohort section, per-target cited column; cross-host concurrency 3→6 (per-host 3000 ms unchanged). One full run committed: 147/157 answered in 13m 54s (2,581 req), block_rate 15.6%, md-neg 8.2%, 41 llms.txt, 4 signers, cited cohort 14.8% / 4.9%, control_passes=true; the 27 v1 targets reproduced v1 exactly (0 flips). | 2026-09-10 | 2e909de, 488dcfe, 3dba79c | Executed on main, NOT pushed — orchestrator to review/merge/deploy. 30/30 probe tests, npm test 446/449 (2 known embed fails), check:patterns clean. 7 open items for Dan in SUMMARY (robots_unreachable vs explicit disallow split; 429-as-blocked; cloaking noise). | [260910-g0f-reciprocal-pass-v1-1-expand-targets-to-1](./quick/260910-g0f-reciprocal-pass-v1-1-expand-targets-to-1/) |
| 261105-cxt | Fix the 2 stale `embed-skills.test.js` B-2 subprocess tests (Phase 3.2 Task 9) that kept the lint-pipeline `test` job red since 2026-09-15 — rewritten against the quick-260804-dy2 prior-overlap drift rule (60-record synthetic input above the 50-prior floor; growth + below-floor proceed cases pinned); embed-skills.js untouched | 2026-11-05 | cd7509e | Verified locally (npm test 450 tests / fail 0 / 6 skipped; embed-skills.test.js 5/5; check:patterns clean). PR to main open — done when its `test` check is green. | [261105-cxt-fix-embed-skills-test-drift-contract](./quick/261105-cxt-fix-embed-skills-test-drift-contract/) |

> **Baseline note (2026-11-05, quick-261105-cxt):** the "2 known embed-skills fails" cited in the 260806-ejd, 260806-f00 and 260910-g0f rows above (and in `04.1-VALIDATION.md` on the unmerged `feat/v4.0-data-feeds` branch) were the stale Task 9 B-2 tests, not a code defect. From 261105-cxt onward the `npm test` baseline is `# fail 0`; a red `test` check carries signal again.

Progress: Phase 1.5 [██████████] 100% · v2.0 [██████████] 100% · 3.0.x trilogy [██████████] 100% · 3.1.1 F1 [██████████] 100% · 3.1 filter overhaul [██████████] 100% (shipped 2026-05-27) · 3.1.2 polymorphic envelope [██████████] 100% (shipped 2026-05-28) · 3.1.3 agent hub [██████████] 100% (shipped 2026-05-29) · 3.1.4 filter v2 writer [██████████] 100% (shipped 2026-05-30) · **3.2 plugin+MCP scoring [██████████] 100% (plan executed; branch-CI smoke pending)** · 3.3–3.9 [░░░░░░░░░░] 0%

## Phase 3.2 Quick-Start Guide (for fresh session)

**Goal:** Add `entity_type: 'plugin'` and `entity_type: 'mcp_server'` to the catalog pipeline. Mixed-type feeds. Plugins + MCPs in `/api/v1/search?type=...`. Daily-scrape produces fresh plugin + MCP data.

**Plan artifacts:**

- `.planning/phases/3.2-plugin-and-mcp-scoring/3.2-CONTEXT.md` — 11 user-locked decisions
- `.planning/phases/3.2-plugin-and-mcp-scoring/3.2-PLAN.md` Rev 2 — 14 tasks, executable
- `.planning/phases/3.2-plugin-and-mcp-scoring/3.2-PLAN-CHECK.md` — Rev 1 (3 BLOCKERs/7 FLAGs) → Rev 2 PASS

**Fresh data ready:**

- `data/plugins-raw.ndjson` — 7,339 records, scraped 2026-05-30
- `data/plugins-meta.json` — stats: 3,112 plugin.json + 4,687 marketplace + 38 MCPs + 4,191 with skills + 1,625 agents

**Critical context for the new session:**

1. **MCPs are a separate entity_type 'mcp_server'** (per D-10). McpExtra typedef stubbed; needs full expansion.
2. **Bidirectional bundling** (per D-02): `bundled_in_plugins: []` on skills, `bundled_skills: []` etc. on plugins. Data only in 3.2; display deferred to 3.3.
3. **5h cron timeout WAS HIT** on 2026-05-30 at 09:00 UTC (scheduled run cancelled). Task 13 in PLAN.md addresses with mitigation D+C (timeout 300→330 min + reduce enrich K 5→3). Three runtime gates enforce this.
4. **D+7 cutover** (legacy-skill-reader.js cleanup) is ~2026-06-04. Phase 3.2 must NOT block this; plugin+MCP work happens on its own branch.
5. **Phase 3.1.4 shipped** the v2-write filter.js. New session can assume `data/skills.ndjson` is v2 shape with `_header` line.

## Open Items (carryover for fresh session)

### Phase 3.2 ready to execute

- `/gsd:execute-phase 3.2` — spawns gsd-executor against 14-task plan; ~3-4h autonomous + branch CI validation

### Operational items

- **2026-05-30 09:00 UTC scheduled cron CANCELLED at 5h timeout.** Task 13 in PLAN addresses. Today's 06:30 UTC cron (in progress shortly after this handoff) is the next observation.
- **Phase 3.1.2 D+7 cleanup** (~2026-06-04, ~4 days away) — Delete legacy-skill-reader.js, flip lint-no-legacy-skill-shape.js to fail mode. Can ship as small standalone PR after Phase 3.2 OR be folded in.
- **PAT scope:** User's fine-grained PAT lacks `mergePullRequest` permission. Uses GitHub UI for PR merges. Workflow_dispatch via `gh workflow run` also 403s; UI also works. Could be fixed permanently with `gh auth refresh -s repo,workflow`.

### Carried forward (still pending; not blocking)

- Smoke seed annual review (`data/smoke-seed.json` — some entries deliberately don't exist, verify they still 404)
- Cron-failure external webhook alert (deferred backlog)
- HNSW migration for compute-similar (Phase 3.x; mitigation in 3.2 task 13 is interim)

## Completed Milestones

### Phase 1.5 — Built on the MVP (shipped 2026-04-10 through ~2026-04-13)

- [x] Phase 1: Content & UX Fixes (hero stat, sticky search, expand-to-all)
- [x] Phase 2: Data Moats (skill birth dates, star-history backfill, growth + maintenance charts)
- [x] Phase 3: Distribution (tier-badge SVGs, star-history SVGs for external embed)
- [x] Phase 4: Creator Pages (`/creators/[username]`, leaderboards, computed badges)
- [x] Phase 5: Analytics (Cloudflare Web Analytics, PostHog events, D1 search query log)
- [x] Phase 6: Infrastructure Groundwork (`/skills-registry.json`, `/llms.txt`)
- [x] Phase 1.5.1: Creators browse table at `/creators/all/`

### Milestone v2.0 — Agent-Native Directory (shipped ~2026-04-13)

- [x] Phase 2.1: Semantic search (OpenAI embeddings + Cloudflare Vectorize, `/api/v1/search` + homepage)
- [x] Phase 2.2: KV query cache — code shipped 4/13, **namespace activated 2026-05-16**, deployed
- [x] Phase 2.3: Similar-skills enrichment (top-5 precomputed, rendered on detail pages)
- [x] Phase 2.4: marketplace.json federation (`.claude-plugin/marketplace.json` with 193 plugins)
- [x] Phase 2.5: Clustering + emergent categories (compute-clusters.js produces `data/skill-clusters.json`; visual page deferred to a future phase)

### Milestone v3.0 — Infrastructure trilogy (shipped 2026-04-14 → 2026-05-17)

These were INSERTED ahead of the Phase 3.0 spec's 3.1–3.9 lineup because the daily pipeline was broken and needed to be fixed first.

- [x] **Phase 3.0.0: Split-track scrape architecture** (Track 1 daily Star Pulse + Track 2 daily discovery)
- [x] **Phase 3.0.1: State persistence** (GHA cache + release-asset bootstrap for skills-raw.json; switched discovery from `/search/code` to `/search/repositories`)
- [x] **Phase 3.0.2: Discovery cost reduction** (content_sha-based skip via tree blob shas; per-repo SKILL.md file cap)
- [x] **Bonus fixes:** ETag cache bootstrap (4/26), V8 string-limit streaming write (4/26), saveETagCache regression fix, OPENAI_API_KEY secret name correction, KV namespace activation, bot push permission (`contents: write`), `|| true` removal on `git push`

**Outcome:** daily-scrape.yml runs unattended at 06:30 UTC, finishes in ~15 min, commits fresh data back, deploys to Cloudflare. Verified working `2026-05-17` (commit `ebb5a80` was the first real bot commit since 2026-04-11).

## Open Items

### Ready to execute next session

- **Phase 3.1 (Filter overhaul)** — `/gsd:execute-phase 3.1`
  - 10 tasks, 5 waves, ~4-6 hours
  - Drops MAX_PER_REPO + MIN_STARS gates
  - Adds embedding-based dedup (0.92 cosine, validated empirically)
  - Adds novelty scoring (percentile-based, NOT spec's 0.45 absolute — research showed that's noise floor)
  - Fixes 13 slug collisions (audit said 6; reality is 13)
  - Catalog will grow from 1,885 → ~5-15k skills
  - Spec corrections folded into `docs/PHASE-3.0-SPEC.md`

### Carryover (still pending; not blocking)

- [ ] `scripts/scrape-plugins.js` uncommitted local diff (defensive null-safety). Memo at `.planning/MORNING-SCRAPE-PLUGINS-MEMO.md`. Recommended: commit. Pending sign-off.
- [ ] `data/plugins-raw.json` (~34 MB, gitignored) sitting on disk from 4/13 plugin discovery scrape. Will be Phase 3.2 input.
- [ ] Smoke seed annual review (`data/smoke-seed.json` — some entries deliberately don't exist, verify they still 404)

### Phase v3.0 sub-phase queue (per `docs/PHASE-3.0-SPEC.md`)

- [ ] 3.1: Filter overhaul — **planned, ready**
- [ ] 3.2: Plugin scoring + filtering — not yet planned (`data/plugins-raw.json` is the input)
- [ ] 3.3: Plugin pages — not yet planned (depends on 3.2 output shape)
- [ ] 3.4: New & Noteworthy section — not yet planned (consumes 3.1's `novelty_score`)
- [ ] 3.5: Homepage + nav redesign — not yet planned (depends on 3.3 for plugin data)
- [ ] 3.6: Tier rename Featured→Top — not yet planned (codebase-wide rename)
- [ ] 3.7: Pipeline integration — daily cron handles both skills + plugins
- [ ] 3.8: Cross-entity enrichment — creator profiles + API graph include plugins
- [ ] 3.9: /trends page — needs ~30 days of daily snapshot data (started compounding 2026-05-16)

### Deferred to backlog

- HNSW / k-d tree migration for novelty when corpus grows past ~20k (O(n²) becomes expensive)
- compute-clusters.js wiring decision (orphaned from prebuild; wire in or delete)
- Star-history incremental refresh (any new Featured skill lacks star-history.json until re-run)
- Embed star-history SVG on own detail pages (currently external-embed-only)
- Cron-failure external webhook alert
- PHASE-1.5-SCOPE.md Pagefind reference cleanup

## Performance Metrics

**Velocity (this session window 2026-04-13 → 2026-05-17):**

- 3 infrastructure phases shipped (3.0.0, 3.0.1, 3.0.2)
- ~15 distinct bug fixes / config corrections across the cascade (timeout, save-on-cancel, V8 limit, content_sha skip, mega-repo cap, OPENAI_API_KEY, KV namespace, bot permission, etc.)
- Phase 3.1 fully planned (research → plan → check → revision → re-check PASS)

**Pipeline observability:**

- Daily run: ~15 min (target was <30; achieved)
- Daily request budget: comfortable (~500-800 fresh GitHub API requests; <20% of 5000/hr limit)
- Cache hit rates: high after first warm day; etag cache + skills-raw cache both bootstrapped from release assets

**Phase 4.1 execution metrics:**

| Phase | Plan | Duration | Tasks | Files | Notes |
|-------|------|----------|-------|-------|-------|
| 04.1 | 02 | 5min | 3 | 6 | Wave 0 red tests: 49 tests across 6 files; 5 files ERR_MODULE_NOT_FOUND, common.rules 3 pass / 2 fail by design |
| Phase 4.1 P01 | 6min | 3 tasks | 4 files |
| 04.1 | 04 | 8min | 3 | 5 | access.js 12/12 + upcaster 13/13 green (25 total); 8/8 fixtures upcast with null repo_*; full suite 487/470 pass, 11 fail = 2 pre-existing + 9 intended red; schema_version stays 2 |
| Phase 4.1 P06 | 5min | 3 tasks | 8 files |
| Phase 4.1 P05 | 5min | 2 tasks | 8 files |
| Phase 4.1 P07 | 7min | 3 tasks | 6 files |
| Phase 4.1 P08 | 7 min | 3 tasks | 3 files |

## Accumulated Context

### Roadmap Evolution

- Phase 3.4 added after Phase 3.3 (2026-06-14): Incremental plugin discovery. Phase 3.3's plugin/MCP PAGES shipped, but the pipeline re-enable (Plan 07) hit a measured NO-GO — plugin discovery is rate-limit-bound (~24h full sweep; run 27472968169). The bootstrap cache only avoids re-fetching content; the per-repo discovery walk over ~7,300 repos burns the 5,000 REST/hr budget. Re-enable deferred to 3.4, which makes discovery incremental (skip-known-repos / GraphQL batch) so the sweep fits, then flips `PLUGINS_ENABLED='true'`. User-flagged as the immediate next priority. See `3.3-plugin-pages/3.3-07-MEASUREMENT.md`.
- Phase 3.2.1 inserted after Phase 3.2 (2026-06-10): HNSW optimization — replace O(N²) cosine scans (compute-similar.js + enrich.js dedup) with approximate-NN; folds in security Audit B content-scanner filter (URGENT — cron at 4.5-5.5h vs 360-min hard cap; blocks 3.3 plugin re-enable)

### Decisions log (cumulative; see `.planning/SESSION-MEMO-2026-04-to-05.md` for full reasoning)

- (4.1-01) Fixtures live at `data/__fixtures__/apis-mini.ndjson` + `datasets-mini.ndjson` (plugins-mini/mcp-mini precedent), not CONTEXT D-09's non-existent `scripts/test/fixtures/`. Raw-ish upcaster inputs: no `schema_version`, no top-level `slug`, `raw_source` documents the verbatim source keys for the 4.2/4.5 harvesters.
- (4.1-01) Round-trip test asserts `null` on all 16 `repo_*` keys for null-repo api/dataset records but only the 13 COERCED keys non-null for repo-backed skill/plugin/mcp_server types (`repo_license`/`repo_language`/`repo_description` stay `?? null` on every type).
- (4.1-01) D-07 red baseline recorded in `04.1-01-SUMMARY.md`: round-trip fails at ESM link (`generate-registry.js` lacks `buildRegistryEntry` export — Plan 07); workflow-flags 2 pass / 2 fail (flag-present + spec-pointer red — Plan 08). Plans 04-07 and 08 are measured against these outputs.
- (4.1-03) ProvenanceMethod declares D-03's six values (adds `heuristic` to the spec's five); CONTEXT.md D-03 is the locked source over docs/PHASE-4.0-SPEC.md
- (4.1-03) `access: AccessBlock` lives ONLY on the api/dataset EntityRecord union members (D-03) — never on EntityCommon, never under `extra`; types.test.js slices EntityCommon and asserts no `access:` inside it
- (4.1-04) The D+7 "delete `scripts/lib/legacy-skill-reader.js`" plan is SUPERSEDED: it is the production upcaster (filter.js / filter-plugins.js / filter-mcps.js route every record through `upcastRecord`) and 4.1 made it the single choke point for `repo_*` nullability + `origin` defaults — RENAME at cutover, do not delete (file header updated).
- (4.1-04) `repo_*` nullability is decided PER RECORD (`nullableRepo = !rec.repo_full_name`), not per entity_type: an api with a resolved GitHub repo gets the exact skill coercions (missing `repo_topics` → `[]`, missing `repo_owner_type` → `'User'`); only the no-repo case emits null. `buildCommonFields(rec, { nullableRepo, defaultSource })` keeps the github-origin branch byte-identical to pre-4.1.
- (4.1-04) `origin`/`home_url`/`docs_url` reach already-v2 production files via IN-PLACE back-fill on the upcaster's passthrough branch (`backfillOriginInPlace`, Research Pitfall 1) — same object returned, no data migration, no `schema_version` bump (stays 2, pinned by comment in entity-version.js). api/dataset without an origin fall back to `kind: 'manual'`, never a fabricated github origin.
- (4.1-04) `scripts/lib/url-host.js` `hostOf(url)` is the shared host extractor: upcaster api id default `api:<host(base_urls[0]) || provider>/<name>`, Plan 06 recipe `computeId`, Plan 07 slug disambiguator must all use it to stay in id parity. Dataset id is `dataset:<origin.source>/<origin.source_id>`.
- (4.1-06) `dedupLanguageVariants` scope key is `repo_full_name ?? origin?.source_id ?? id ?? ''` (D-07, Research Pitfall 3): a null repo never becomes the literal `"null/<name>"` scope, so two null-repo feeds named alike from different providers survive dedup; skills (always non-empty `repo_full_name`) keep byte-identical keys. `isFixtureRepo` change (`?? ''`) is readability-only.
- (4.1-06) `rulePacks.api` / `rulePacks.dataset` (D-06) read NO `repo_*` fields: common gates → `MIN_DESCRIPTION_LENGTH 50` → `HAS_HOME_URL` → `HAS_BASE_URL_OR_SPEC` (api) / `HAS_DOWNLOAD_OR_LANDING` (dataset). `HAS_DOWNLOAD_OR_LANDING` is redundant under `HAS_HOME_URL` and kept only for D-06 parity (commented inline); a landing page alone passes.
- (4.1-06) `recipes.api` / `recipes.dataset` `computeId` are the id-parity twins of the Plan 04 upcaster default (same `hostOf`, same `provider` fallback, same `origin.source/source_id`) and are pinned by an 8-fixture replay (`computeId(raw) === raw.id` over apis-mini + datasets-mini). 4.2/4.5 harvesters must extend the fixtures rather than invent id rules; `discover()` stays empty until `harvest-apis.js` (4.2) / `harvest-datasets.js` (4.5).
- (4.1-06) Parallel executors in ONE worktree share the git index: a plain `git add` + `git commit` in Plan 06 swept Plan 05's concurrently-staged scorer files into `8d893f5` (left as-is; content green). Wave-parallel plans should commit with `git commit --only -- <paths>` (or add+commit in one chained command).
- (4.1-05) `scorers.api` / `scorers.dataset` (D-06) carry the spec weight table VERBATIM in `feed.signals.js` `FEED_WEIGHTS` (access .20 / reachability .15 / docs .15 / license .15 / freshness .15 / popularity .15 / adoption .05) and are UNCALIBRATED — tune in 4.2 (api) / 4.5 (dataset), never here, and never in `scripts/score.js` (skill calibration, untouched). Neutral defaults: reachability 70 (until 4.4 probe history), popularity 50 (GitHub stars only when `repo_stars` is a number; source percentiles are 4.5), adoption 0 (`consumed_by` empty until 4.6). Freshness with no `source_modified_at` AND no `repo_pushed_at` scores 0, not neutral — the input exists at harvest time for every verified source. Bare record = exactly 18.
- (4.1-05) Both feed scorers write `record.extra.access_clarity` (0-1, `accessClarity(record.access)`) as a side effect — same convention as `extra.manifest_completeness` on plugin/mcp — so the Plan 04 upcaster default of 0 is overwritten on every score pass. Freshness is the ONLY signal that differs between api (`scoreRecency`, 180d cliff) and dataset (`scoreDatasetFreshness`, 365d cliff).
- (4.1-05) `builders.api` reads `extra.endpoint_summaries` (first 10, `'; '`-joined 5th segment) ONLY when present — it is a 4.2 field, so the harvester adds it without touching `embedding-input/api.js`. Both feed builders hard-`slice(0, 300)` and emit empty segments (never `'undefined'`) for missing provider/publisher. Plan 05 Task 1's scorer files landed inside Plan 06's `8d893f5` via the shared-index race above; content verified identical, history left unsplit; Task 2 is the clean `b0c94b6`.
- (4.1-07) `assignSlugs` resolves (owner, repo) through `slugParts(s)` (D-05), dispatching on `entity_type` BEFORE `repo_full_name`: api → `<provider>/<name>` with `hostOf(base_urls[0])` as the collision disambiguator (so a repo-backed api like github/rest-api-description still slugs `github.com/github`, not `github/github`); dataset → `<publisher>/<name>` with `origin.source` as disambiguator; everything else the unchanged `repo_full_name` split. `slugParts` does NOT slugify name/provider/publisher (that would silently rewrite every skill slug and invalidate `data/slug-redirects.json`) — 4.2/4.5 harvesters must supply slug-safe values. Slugs are scoped PER entity type because production never mixes types in one `assignSlugs` call.
- (4.1-07) Slug-collision winner tie-break is `(repo_full_name ?? id ?? '').length` (D-07) — `??` not `||` keeps skills byte-identical; null-repo feeds fall through to the shorter id. `assignPercentileTiers` coerces at the sort-key build site (`stars: s.repo_stars ?? 0`), never in the comparator, so the comparator stays byte-for-byte with filter.js Step 3; this closes Research Pitfall 4 (null !== 0 skipped the id ASC tie-break → input-order-dependent featured slot).
- (4.1-07) `scripts/generate-registry.js` now exports `buildRegistryEntry(s, apiGraph)` + `main()` behind the generate-feeds.js `invokedAsScript` guard (importable by tests without `data/`); the ONLY content change is `install_command: null` for null-repo records (never the string `claude install-skill null`). Parity proven empirically, not by inspection: HEAD vs new on the worktree's legacy `data/skills.json` is byte-identical modulo `generated_at` (1,105 entries, 1,139,004 bytes). Registry stays skills-only (`loadSkillsArray`) until 4.3.
- (4.1-07) D-07 null-safety sweep CLOSED for every shared helper the round-trip exercises: `data-feeds-roundtrip.test.js` GREEN 7/7 (4.1-M10); `npm test` 535/525/4 fail/6 skipped — remaining reds are exactly 2 pre-existing embed-skills + 2 workflow-flags (Plan 08).
- (4.1-08) `DATA_FEEDS_ENABLED: 'false'` lives in daily-scrape.yml job env directly under `PLUGINS_ENABLED` (D-08) with NO `if:` guards and no new steps — 4.2 gates harvest/filter/embed/upload the PLUGINS_ENABLED way and flips it. The YAML comment must never quote the literal `env.DATA_FEEDS_ENABLED`: `workflow-flags.test.js` asserts zero occurrences until the gating phase ships.
- (4.1-08) CLAUDE.md Vectorize cost corrected in both the Cost headline and the Cost-ceiling constraint to the verified pricing (Workers Paid includes 10M stored dims, then $0.05 per 100M/month; 50M queried dims/month included, then $0.01 per 1M — the prior per-million figure was 100× too high): ~$73/yr actual, <$1/yr Vectorize at ~160M dims, so cost is NOT a governor for the v4.0 embed-everything decision; the ~$102/yr approved ceiling stays as the constraint. Known issue 9 now records the 04.1-04 decision: rename `legacy-skill-reader.js` at the 3.1.2 D+7 cutover, do not delete it.
- (4.1-08) Phase 4.1 gate PASSED at exactly the planned baseline: `npm test` 535 tests / 527 pass / fail 2 / skipped 6 (N = 86 = 60 new-file + 26 extended; invariant pass = tests − 8), the two fails are the pre-existing embed-skills `Task 9: B-2` pair; `check:patterns` clean (0 baselined, 0 new); legacy-shape lint 5 hits exit 0; `scripts/filter.js` / `scripts/score.js` untouched since `cbae842`. `04.1-VALIDATION.md` signed off (`nyquist_compliant: true`, 14/14 rows green). Branch `feat/v4.0-data-feeds` unpushed, awaiting `/gsd:verify-work 4.1` + Dan's review.
- (4.1-03) Phase 4.1 type additions are additive: `schema_version` stays 2 and `TYPES_MODULE` stays `'claudeatlas/types@2'`; all sixteen `repo_*` fields are `T | null` gated on `origin.kind === 'github'` (upcaster never emits null for skill/plugin/mcp_server)
- (4.1-02) Feed-scorer round-half totals (25.5 / 28.5) are asserted as 25|26 / 28|29 bands plus ordering against the bare record, never exact — Plan 05 may use plain `Math.round` with no tie-break convention. Exact totals pinned test-first: bare api/dataset 18, +freshness 33, +full access 38, +5 consumers 23, dataset@100d 29.
- (4.1-02) `common.rules.test.js` dedup regression test lists `foo-de` BEFORE `foo` (plan revision 1 / B1): the implementation's base-name short-circuit (`rec.name === baseName`) only protects a base record that arrives AFTER a variant; reversed order would be permanently red on quality_score.
- (4.1-02) Pitfall 8 pinned in `dataset.rules.test.js`: the biz-slop prefix list rejects the realistic dataset name `energy-consumption` — documented as CURRENT status quo for Phase 4.5 calibration, not endorsed.

- (3.4-05) Weekly full re-walk SPLIT out of the daily cron (3.4-04 measurement: worst-case Sunday total ~332 min, only ~28 min margin under the 360 cap on a growing O(n²) skills build). The full-rewalk trigger in scrape-plugins.js is now ENV-ONLY via a new exported `isFullRewalk(env)` helper (`PLUGINS_FULL_REWALK==='1'`); the old `|| new Date().getUTCDay() === 0` Sunday auto-trigger was REMOVED, so the daily cron only ever walks the cheap pushed_at-changed delta (~2h, comfortable margin). New `.github/workflows/weekly-plugin-rewalk.yml` (Sundays 02:00 UTC, own 360-min budget, lean: checkout → npm ci → restore/save plugins-raw-ndjson- cache → scrape-plugins.js with PLUGINS_FULL_REWALK=1, NO filter/embed/build/deploy/publish) does the full re-walk and saves under the SAME `plugins-raw-ndjson-` cache prefix the daily cron's restore-keys prefix-matches, so the daily cron picks up the fresh corpus and publishes it. Secrets match the daily plugin step (SCRAPE_PAT=GITHUB_TOKEN/REST + SCRAPE_PAT_CLASSIC/GraphQL). check-banned-patterns plugins-meta.json allowlist re-pinned 761→785. Unblocks the Plan 04 flag flip (after a steady-state branch re-measurement). PLUGINS_ENABLED untouched (still 'false' on main).
- (3.4-03) Change C completeness gate: exported pure `shouldRewalk(known, freshPushedAt, opts)` re-walks a KNOWN plugin repo ONLY when its fresh `pushed_at` (Plan 02's GraphQL Map) advanced past the stored `walked_pushed_at` — missing stamp → backfill (re-walk once), missing fresh signal (refresh casualty) + valid stamp → keep cached, `opts.periodicFull` → always. ISO-string lexicographic `>` (= chronological) avoids null Date parsing; mirrors Track 2's blob-sha skip at repo granularity. `walkComponentDirs` rewritten as ONE `git/trees/{branch}?recursive=1` scan (was ~6-18 contents calls/repo, now ETag 304-free warm) emitting the BYTE-IDENTICAL `inventory[dir]={path,count,entries}` shape (git tree/blob → contents-API dir/file, single-level immediate children) — `mcp-servers` component preserved (R-5/Pitfall 6; filter-mcps `MIN_MCP_REPOS=10`). Re-walked known repos OVERWRITE their prior `allRepos` record via `indexByName` so OUTPUT has no duplicate `repo_full_name`s. Periodic full re-walk safety net = weekly UTC Sundays (`getUTCDay()===0`) + `PLUGINS_FULL_REWALK=1` override + `[gate] periodicFull=...` log line for Plan 04's mode-aware measurement. check-banned-patterns `plugins-meta.json` allowlist re-pinned 634→761. The warm plugin step is now bounded to (new repos) + (repos pushed since last walk) + (everything, once weekly).
- (3.4-01) Cross-run plugin skip now seeds `processedSet` from the cached OUTPUT `data/plugins-raw.ndjson` via new exported `buildProcessedSeedFrom(OUTPUT_PATH, PARTIAL_PATH)`, merging the same-job `.partial` with `.partial` winning per-repo. The pre-3.4 `loadCheckpoint()` read ONLY the never-cached `.partial`, so `processedSet` started empty every run and all ~7,300 repos re-walked cold (~24h → the 3.3 re-enable NO-GO). main() now logs `resume: N known repos seeded from OUTPUT+partial` (Pitfall-1 warning-sign instrument for Plan 04). RESEARCH Q1 option a; main() skip loop unchanged. check-banned-patterns allowlist re-pinned 483→520 (Change A shifted the plugins-meta.json sidecar write).
- (3.3-01) marketplace_listings elements are `{ path, name }` objects: path = owner/repo for `/plugin marketplace add`, name = declared marketplace_manifest.name for the `@name` install token (null → GitHub fallback); pre-3.3 records stored bare strings, loaders normalize both
- (3.3-01) upcastPluginRecord routes marketplace_listings through listingArr() (objects + legacy strings) — the string-only arr() silently dropped the {path,name} entries and would have broken the listing-only HAS_MANIFEST_OR_LISTING slop gate
- (3.3-01) scrape-plugins.js import is side-effect free: GITHUB_TOKEN check moved into main(), invoked-as-script guard added (mirrors filter-plugins.js); loadCheckpointFrom/saveCheckpointTo exported for tests — and loadCheckpoint now reads the NDJSON .partial via readNdjsonRecords, so processedSet resume works for the first time (D-02)
- (3.3-02) Plugin/MCP page data flows through NEW `src/lib/plugins.js` (streaming readNdjsonRecords on plugins.ndjson + mcp-servers.ndjson) — `entities.js getEntitiesByType('plugin')` returns [] at build time (skills-only loader)
- (3.3-02) resolveBundledSkills is prefix-tolerant: on-disk skill IDs are legacy-UNPREFIXED (0/23,047 carry `skill:`); bundled_skills entries match directly, typedef-prefixed form normalized away on miss
- (3.3-02) installCommand normalizes legacy bare-string marketplace listings to {path, name:null} and never emits the broken `name@owner/repo` token (declared-name only); GitHub fallback always offered
- (03.3-03) Plugin detail pages (/plugins/<slug>/) are FULLY static — getStaticPaths over all 3,584 non-duplicate plugins, NO STATIC_TIERS filter (D-07); author + marketplace chips link to GitHub (creator pages are skill-only, plugin-only owners would 404 on /creators/)
- (03.3-03) Bundles section (D-09) caps SkillCards at 12 with a native <details> show-all disclosure — largest bundler (3,324 skills) renders 5.97 MB, under the 24 MiB asset guard; empty subgroups + all-empty section hidden
- (03.3-03) sitemap-completeness postbuild gate left un-widened despite the expected +3,584-page failure (29,032 locs vs 26,505 cap) — the widening is Plan 05 Task 2's deliverable; phase-level `npm run build` goes green only after Plan 05 lands
- (03.3-04) MCP detail pages omit Similar/Integrates sections and link authors to GitHub (no MCP similarity corpus at n=76; creator pages are skill-owner-only); JsonLd stays schema.org Article with mcp_server carried in keywords
- (03.3-04) Astro template HTML comments survive into built output — keep UI strings out of them so grep-based page verification stays unambiguous (caught when an unbundled skill page matched "Bundled in these plugins" via the comment alone)
- (3.2.1-02) Audit B content scanner ships flag-don't-block: `content_flags[]` annotations recomputed from the raw 5000-char body every run (NOT in PRESERVED_FIELDS), scanned pre-truncation in filterRaw Step 1c; the only blocking mechanism stays FIXTURE_REPO_DENYLIST
- (3.2.1-02) content_flags passthrough added to upcastSkillRecord + buildCommonFields (the v2 builders are field whitelists, not spreads) so the annotation survives the v2 NDJSON write
- 0.92 cosine threshold validated empirically for duplicate detection
- Novelty is percentile-based (top 5%), NOT absolute 0.45 (spec corrected)
- Active-fork detection is dead code (scrape skips git forks); replaced with semantic-clone via skill_first_commit_at
- Discovery uses `/search/repositories` not `/search/code` (latter doesn't support `pushed:>`)
- `skills-raw.json` persists via GHA cache + release-asset bootstrap (gitignored on disk; ~295 MB)
- `etag-cache.json` same pattern (gitignored; ~500 MB)
- Novelty computed locally from `data/skill-vectors.ndjson` (NOT Vectorize ANN — would break $12/yr budget)
- Pipeline is multi-pass: Filter → Embed → Enrich → ... — dedup needs vectors so can't happen in single pass
- `is_duplicate` filtered site-side in `src/lib/skills.js` default-browse helpers (direct URLs unaffected)
- `PRESERVED_FIELDS` extended so one-day enrich failures don't wipe dedup state
- Plugin work explicitly deferred to Phase 3.2 + 3.3; Phase 3.1 is skills-only
- (3.2.1-01) ann.js owns exact verification: hnsw candidates re-scored via dot(), index 1-distance discarded — hnsw/exact parity is exact float equality, false dedup merges impossible
- (3.2.1-01) hnswlib-node is an optionalDependency only; lint CI test job compiles the native addon and runs npm test with ANN_REQUIRE_HNSW=1 (lint job keeps --ignore-scripts)
- (3.2.1-03) enrich.js dedup migrated to ann.js topKNeighbors (K_DUP=64, efSearch=150): present[] sorted by skill.id for determinism, candidate edges symmetrized; BFS clustering, compareForCanonical, novelty, PRESERVED_FIELDS interplay all unchanged; 600s hard-warn retargeted as the engine-fallback regression tripwire
- (3.2.1-04) compute-similar.js migrated to ann.js topKNeighbors under a pre-swap 7-test shape baseline (Wave-0 lock): output key order is now slug-sorted (caller-sort contract, shape-neutral), computeSimilar() nulls rec.values after Float32 normalization (Pitfall 7), TOP_K=3 now output-size-only, 'similar-skill sets in Ns' log line preserved for Plan 05's timing gate
- (3.2.1-06) FIXTURE_REPO_DENYLIST extended 2 → 6 entries, all 4 Audit B candidates human-verified 2026-06-11 and approved (majiayu000/claude-skill-registry + -data aggregator mirrors, liminal-ai/skill-scanner-ts scanner port, RekitRex21/Dino_Scan preventive); denylist stays exact repo_full_name match, regression test locks the contract incl. a near-miss negative
- (3.2.1-05) Engine/timing gates wired into daily-scrape: enrich + Build logs tee'd (set -o pipefail first), non-push gate steps grep '[ann] engine=hnsw' (anti-silent-fallback, Pitfall 2) and enforce <900s elapsed via awk, failing loudly if ELAPSED parses empty; validate_ann dispatch input runs the four-gate recall harness BEFORE enrich so a FAIL stops the run pre-publish
- (3.2.1-05) validate-ann-recall.js mirrors per-consumer production semantics: symmetrized top-1 (enrich nnSim parity) vs unsymmetrized top-K (compute-similar parity); misses-only invariant (annPairs ⊆ exactPairs) fails the run regardless of recall; hard-requires annEngine()==='hnsw' — CI-only by design
- (03.3-06) bootstrap-plugins-raw.yml authored with cache key prefix locked to `plugins-raw-ndjson-` so daily-scrape.yml's existing restore-keys prefix-match works with zero consumer changes; dispatch + release creation + PLUGINS_ENABLED flip stay human-gated in Plan 07 (measure-before-flip)
- (03.3-05) /plugins/ category chips are display-only and tag-derived: /category/<slug>/ pages are skill-scoped so plugin chips don't link there; labels come from `category:<slug>` tags via slug→label map (legacy .category field unused, removed in 3.6)
- (03.3-05) Search endpoint carried on a `data-search-endpoint` input attribute — Astro/Vite bundles page scripts into hashed assets, so the attribute keeps the type=plugin wiring visible in static HTML; result renderer builds /plugins/<slug>/ page-side (worker detail_url is skill-hardcoded)
- (03.3-05) check-sitemap-completeness expected basis widened to skills+plugins+mcp wc -l counts (existsSync-guarded → 0 when absent); tolerance max(1500, 15%) computed on the combined basis — gate green at 29,035 locs in [26,685, 30,716]

### Spec corrections (rolled into 3.1 Task 8)

- `docs/PHASE-3.0-SPEC.md` will be updated to:
  - Replace "0.45 novelty" with "top 5% by novelty percentile"
  - Replace "active-fork detection (10+ unique commits AND embedding distance > 0.1)" with "semantic-clone via skill_first_commit_at"
- This prevents 3.2-3.9 planning from inheriting the wrong constants.

### Blockers / Concerns

- **Phase 3.1 enrich.js O(n²) cliff** — fine at 1,885; ~13 min at 20k. Hard-warn baked in. May need HNSW migration in 3.x.
- **Plugin scraper has uncommitted local diff** — disposition recommended (commit) but awaiting sign-off.
- **No automated alerting on cron failures** — currently relies on user noticing the site is stale. Worth adding a Discord/webhook alert in a future ops phase.

## Session Continuity

Last session: 2026-11-05T02:24:06.749Z
Stopped at: Completed 04.1-08-PLAN.md (phase 4.1 complete — gate green, awaiting verify-work)

**Resume:** read `.planning/SESSION-MEMO-2026-04-to-05.md` for full context, then `/gsd:execute-phase 3.1`.

**Verification commands** to confirm state on resume:

```
gh run list --workflow=daily-scrape.yml --limit=3 --repo dwalshx/ClaudeAtlas
git log origin/main --oneline -5
ls data/history/
```

Expect: recent runs green, fresh bot commits, growing snapshot count.
