---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Phase complete — ready for verification
stopped_at: Completed 3.4-incremental-plugin-discovery-05-PLAN.md
last_updated: "2026-06-15T05:34:26.278Z"
last_activity: 2026-06-15
progress:
  total_phases: 19
  completed_phases: 7
  total_plans: 30
  completed_plans: 30
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (last updated 2026-04-10)

**Core value:** Users can find the best Claude skill for a given task in under 30 seconds, with visible signals for why it's trustworthy.
**Current focus:** Phase 3.4 — incremental-plugin-discovery
**Milestone:** v3.0 — Comprehensive Agent Tooling Index (in progress)

## Current Position

Phase: 3.4 (incremental-plugin-discovery) — EXECUTING
Plan: 4 of 4
Next phase: 3.4 (incremental plugin discovery) — NOT YET PLANNED
Next action: **`/gsd:plan-phase 3.4`** — make `scripts/scrape-plugins.js` discovery incremental so the plugin pipeline fits the daily budget, then flip `PLUGINS_ENABLED='true'` (the one step left from 3.3). User flagged this as the immediate next priority.

**Why 3.4 exists / 3.3 re-enable NO-GO:** Plan 07 branch measurement (2026-06-13, run 27472968169) proved plugin discovery is rate-limit-bound — ~1,700 of ~7,300 repos in 5.5h, 403 wall every ~800-1,100 repos forcing ~44-min resets, full sweep ~24h. Flipping `PLUGINS_ENABLED` would break the daily cron (Pitfall 5). Full analysis + the three rework levers: `.planning/phases/3.3-plugin-pages/3.3-07-MEASUREMENT.md`.

**What's already in place for the re-enable (so 3.4 is just the sweep fix + a flag flip):**

- `plugins-raw-ndjson-bootstrap` release (permanent, 7339 records) + warm GHA cache `plugins-raw-ndjson-bootstrap-1`
- All plugin/MCP page code shipped + deployed (live-but-empty; `src/lib/plugins.js` degrades gracefully when data absent — commit b9f2ed7)
- `bootstrap-plugins-raw.yml` workflow + daily-scrape gated plugin steps (AND `PLUGINS_ENABLED=='true'`)

**READ FIRST for 3.4:** `3.3-plugin-pages/3.3-07-MEASUREMENT.md` (the NO-GO + levers), then `3.3-RESEARCH.md` §Q2d (sweep cost analysis). CLAUDE.md note #7 documents the Track 1 GraphQL-batch precedent — the same pattern applies to plugin discovery.
Last activity: 2026-06-15

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
| 260603-bug | Add agent-ping affordance endpoint + llms.txt invitation | 2026-06-03 | 098124f | Live (deployed + smoke-verified) | [260603-bug-add-agent-ping-affordance-endpoint-llms-](./quick/260603-bug-add-agent-ping-affordance-endpoint-llms-/) |
| 260603-e96 | Fix failing daily-scrape Track 1 star pulse (retry-after stopgap + GraphQL batch migration) | 2026-06-03 | 921be94 | Needs Review (branch-CI dispatch) | [260603-e96-fix-failing-daily-scrape-track-1-star-pu](./quick/260603-e96-fix-failing-daily-scrape-track-1-star-pu/) |

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

## Accumulated Context

### Roadmap Evolution

- Phase 3.4 added after Phase 3.3 (2026-06-14): Incremental plugin discovery. Phase 3.3's plugin/MCP PAGES shipped, but the pipeline re-enable (Plan 07) hit a measured NO-GO — plugin discovery is rate-limit-bound (~24h full sweep; run 27472968169). The bootstrap cache only avoids re-fetching content; the per-repo discovery walk over ~7,300 repos burns the 5,000 REST/hr budget. Re-enable deferred to 3.4, which makes discovery incremental (skip-known-repos / GraphQL batch) so the sweep fits, then flips `PLUGINS_ENABLED='true'`. User-flagged as the immediate next priority. See `3.3-plugin-pages/3.3-07-MEASUREMENT.md`.
- Phase 3.2.1 inserted after Phase 3.2 (2026-06-10): HNSW optimization — replace O(N²) cosine scans (compute-similar.js + enrich.js dedup) with approximate-NN; folds in security Audit B content-scanner filter (URGENT — cron at 4.5-5.5h vs 360-min hard cap; blocks 3.3 plugin re-enable)

### Decisions log (cumulative; see `.planning/SESSION-MEMO-2026-04-to-05.md` for full reasoning)

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

Last session: 2026-06-15T05:34:26.268Z
Stopped at: Completed 3.4-incremental-plugin-discovery-05-PLAN.md

**Resume:** read `.planning/SESSION-MEMO-2026-04-to-05.md` for full context, then `/gsd:execute-phase 3.1`.

**Verification commands** to confirm state on resume:

```
gh run list --workflow=daily-scrape.yml --limit=3 --repo dwalshx/ClaudeAtlas
git log origin/main --oneline -5
ls data/history/
```

Expect: recent runs green, fresh bot commits, growing snapshot count.
