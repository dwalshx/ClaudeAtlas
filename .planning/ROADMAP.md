# Roadmap: ClaudeAtlas — Phase 1.5

## Overview

Phase 1 MVP shipped 2026-04-10 with 33,078 skills scraped, 1,078 curated, and 305 Featured, live at claudeatlas.com on Cloudflare Workers Static Assets. Phase 1.5 is a six-phase milestone that (1) fixes rough edges from Phase 1, (2) starts compounding data moats, (3) adds creator visibility, and (4) lays Phase 2 groundwork for agent discoverability and analytics. Phase structure mirrors the six sections of `docs/PHASE-1.5-SCOPE.md` one-to-one. Phases 1-4 touch the frontend; Phases 5-6 are backend/data-only. No new entity types, no embeddings, no auto-notifications, no submissions — those are Phase 2+.

## Milestones

- Done **Phase 1 MVP** (shipped 2026-04-10) — discovery pipeline, scoring, filter, site, cron
- In progress **Phase 1.5** — Phases 1-6 below
- Planned **Phase 2+** — see `docs/FUTURE-WORK.md`

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: Content & UX Fixes** - Fix the hero stat and rebuild search UX so every indexed skill is reachable above the fold
- [x] **Phase 2: Data Moats** - Backfill skill birth dates and star history, then chart growth and active-maintenance signals
- [x] **Phase 3: Distribution** - Publish embeddable tier-badge and star-history SVGs so creators can link back from their READMEs
- [x] **Phase 4: Creator Pages** - Give every creator a profile, a leaderboard home, and computed badges
- [x] **Phase 5: Analytics** - Wire Cloudflare Web Analytics, PostHog custom events, and a D1-backed search query log
- [x] **Phase 6: Infrastructure Groundwork** - Publish a machine-readable `/skills-registry.json` and document it for agents
- [x] **Phase 1.5.1: Creators Browse Page** (INSERTED) - Full sortable/filterable table of every creator at `/creators/all/`

---

## Milestone v2.0 — Agent-Native Directory

Theme: turn ClaudeAtlas from a browsable site into infrastructure that agents call.

- [x] **Phase 2.1: Semantic Search** — OpenAI `text-embedding-3-small` + Cloudflare Vectorize + `/api/v1/search` public endpoint, homepage wired to semantic matching
- [x] **Phase 2.2: Query latency optimization** — Workers KV cache shipped; **namespace activated 2026-05-16 and deployed**
- [x] **Phase 2.3: Similar-skills enrichment** — pre-computed top-5 per skill, rendering on all detail pages
- [x] **Phase 2.4: marketplace.json federation** — .claude-plugin/marketplace.json with 193 Featured plugins
- [x] **Phase 2.5: Clustering + emergent categories** — 16 clusters computed via k-means; visual page deferred
- [ ] **Phase 1.5.2: Slug collision fix** — make slug computation path-aware (deferred bug from Phase 2.1; rolls into Phase 3.1/3.2 filter overhaul)

---

## Milestone v3.0 — Comprehensive Agent Tooling Index

Theme: from "curated skills directory" to "the Wirecutter of agent tooling." Index everything real (skills + plugins), score on transparent signals, surface novelty automatically. See `docs/PHASE-3.0-SPEC.md` for the full spec.

- [x] **Phase 3.0.0: Split-Track Scrape Architecture** (INSERTED, precursor) — split scrape into Track 1 (daily Star Pulse) + Track 2 (discovery via repo search) so daily pipeline fits inside GitHub Actions' 6h platform cap. Shipped 2026-04-26.
- [x] **Phase 3.0.1: State persistence** (INSERTED) — GHA cache + release-asset bootstrap for skills-raw.json; switched discovery from `/search/code` to `/search/repositories` (latter is the only one that supports `pushed:>`). Shipped 2026-04-29.
- [x] **Phase 3.0.2: Discovery cost reduction** (INSERTED) — content_sha-based skip via tree blob shas (Bug 1) + per-repo SKILL.md file cap at 50 (Bug 2). Daily run dropped from 90-min cancellations to ~15 min reliable completion. Shipped 2026-05-05.
- [x] **Phase 3.1.1: F1 streaming foundation** (INSERTED 2026-05-17; SHIPPED 2026-05-25) — full pipeline migration from JSON-array to NDJSON streaming I/O, eliminating the V8 ~536 MB string-limit failure mode that crashed daily-scrape for 6 days. 8 sub-tasks (T1-T8): chunked NDJSON helpers + lint/size gates; Astro/Vite smoke; centralized streaming + EMBED_DRY_RUN; skills-raw migration + new bootstrap release; skills.json migration + tier-aware rendering (Top/Solid static, Listed dynamic via Workers KV) + release-asset distribution (skills-latest + skills-latest-prev rollback) + sitemap customPages (DOD-10) + URL stability check (DOD-9) + lint strict; plugins-raw migration; timeout bump; rollback rehearsal docs. Production verified: all three tiers serve correctly. See `.planning/phases/03.1.1-streaming-foundation/`.
- [x] **Phase 3.1.2: Polymorphic entity envelope** — research + plan complete (Rev 2 PASS plan-check 2026-05-18). EntityRecord discriminated union; scraper recipe abstraction; tag-based categorization replacing rigid categories. Enables plugins/MCPs/frameworks to share the pipeline. See `.planning/phases/03.1.2-polymorphic-envelope/`. (completed 2026-05-28)
- [x] **Phase 3.1: Filter overhaul** (SHIPPED 2026-05-27) — Catalog grown 1,286 → 35,341 records (28×) via dropped MAX_PER_REPO + MIN_STARS gates. Embedding-based dedup at cosine ≥ 0.92 flags 6,396 duplicates (17.8%) across 3,474 clusters. Percentile-based tier assignment (top 10% Featured / next 30% Solid / rest Listed) replaced absolute thresholds and bounded renderable surface within Cloudflare's free-tier limits — though Cloudflare was upgraded to Workers Paid mid-ship to handle the ~21k Listed-tier KV publish in one daily run. Path-aware `assignSlugs()` resolved ~402 production slug collisions with worker-side 301 redirects. Ship cascade required 6 PRs total — see `.planning/phases/3.1-filter-overhaul/3.1-SUMMARY.md` for the full retrospective. Live at claudeatlas.com.
- [x] **Phase 3.2: Plugin scoring + filtering** — score-plugin.js, filter-plugins.js, calibrate against plugins-raw.json (completed 2026-05-31)
- [x] **Phase 3.2.1: HNSW optimization** (INSERTED 2026-06-10) — replace the two O(N²) cosine scans (`compute-similar.js` ~162min, `enrich.js` dedup ~59min at ~51k records) with approximate-NN (hnswlib-node vs. Cloudflare Vectorize queries — evaluate both); reclaims cron headroom under the 360-min GHA cap and unblocks the Phase 3.3 plugin re-enable (`PLUGINS_ENABLED=true`). Folds in security Audit B (content-scanner filter for curl|bash exfil + jailbreak markers). Context: `.planning/SESSION-HANDOFF-2026-06-10.md` **Planned 2026-06-10: 7 plans, 4 waves** (`.planning/phases/3.2.1-hnsw-optimization/03.2.1-0[1-7]-PLAN.md`): ann.js foundation + Audit B scanner (W1) → enrich + compute-similar migrations + denylist checkpoint (W2) → CI engine/timing gates + recall harness (W3) → branch-CI phase-gate run (W4). (completed 2026-06-11)
- [ ] **Phase 3.3: Plugin pages** — `/plugins/`, `/plugins/[slug]/`, marketplace landing pages
- [ ] **Phase 3.4: New & Noteworthy** — novelty detection, homepage section, percentile-based threshold calibration
- [ ] **Phase 3.5: Homepage + nav redesign** — separate Top Skills / Top Plugins, mixed search results with type chips
- [ ] **Phase 3.6: Tier rename** — Featured→Top throughout; "Featured" reserved for editorial picks
- [ ] **Phase 3.7: Pipeline integration** — daily cron handles both scrapes, embeds both types, generates both registries
- [ ] **Phase 3.8: Cross-entity enrichment** — creator profiles show plugins, API graph includes plugins, search returns mixed results
- [ ] **Phase 3.9: /trends page** — surface rising/trending/new arrivals from compounding daily snapshot data

## Phase Details

### Phase 1: Content & UX Fixes
**Goal**: Users land on the homepage and immediately understand the scale of the curation, then can search across every indexed skill without scrolling below the fold.
**Depends on**: Nothing (first phase)
**Requirements**: UX-01, UX-02, UX-03, UX-04
**Success Criteria** (what must be TRUE):
  1. User lands on the homepage and sees the real `total_discovered` number ("33,078 analyzed · 1,078 indexed · 305 Featured · Updated daily") in the hero, matching `data/pipeline-stats.json`.
  2. The same stat string appears on the methodology page and in the site meta description — no place still says "1,078 analyzed".
  3. User scrolls the homepage and the search input stays pinned in a sticky header bar, with a visible clear-search button.
  4. User types any query and the Featured section is hidden while the results grid expands to show all indexed skills (not just the top 60), with matches visible above the fold.
  5. User searches for a Featured skill by name and it appears in the results — Featured skills are part of the filterable dataset.
**Plans**: TBD
**UI hint**: yes

### Phase 2: Data Moats
**Goal**: Every indexed skill has a true creation date and the top 305 Featured skills have a full star-history backfill, so the homepage can show ecosystem growth and maintenance signals that compound every day the scraper runs.
**Depends on**: Phase 1 (soft — touches `index.astro` which Phase 1 also edits; sequence to avoid merge conflict)
**Requirements**: DATA-01, DATA-02, DATA-03, DATA-04
**Success Criteria** (what must be TRUE):
  1. Every skill in `data/skills.json` has a populated `skill_first_commit_at` field, backfilled from the GitHub commits API against each skill's path.
  2. User visits the homepage (or `/momentum`) and sees a "new skills per week" chart covering the last 12 months, rendered from `skill_first_commit_at`.
  3. User sees an "active maintenance" chart (stacked bar or donut) on the homepage that breaks indexed skills into this-week / this-month / last-3-months / last-6-months / stale buckets using `repo_pushed_at`.
  4. `data/star-history.json` exists, contains one entry per Featured repo (top 305), and each entry is an array of `{timestamp, star_count}` records fetched from the GitHub stargazers API with the v3.star+json accept header.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Distribution
**Goal**: Every indexed skill has an embeddable tier-badge SVG and a star-history chart SVG at a stable URL, so creators can drop ClaudeAtlas badges into their READMEs and drive traffic back.
**Depends on**: Phase 2 (DIST-02 star-history chart reads `data/star-history.json` produced by DATA-04)
**Requirements**: DIST-01, DIST-02
**Success Criteria** (what must be TRUE):
  1. For every indexed skill, `public/badge/[author]/[skill].svg` exists after a build, colored by tier (Featured = gold, Solid = green, Listed = gray), and links back to the skill detail page with `?ref=badge`.
  2. A creator pastes a Markdown image link to the badge in their GitHub README and it renders a valid SVG badge that clicks through to the correct detail page.
  3. For every indexed skill, `public/badge/[author]/[skill]-history.svg` exists, rendering a line chart from `data/star-history.json` + `data/history/*.json` when data is available.
  4. When star-history data is thin or missing for a skill, the `-history.svg` endpoint degrades gracefully to a legible "Not enough history yet" placeholder rather than erroring.
**Plans**: TBD
**UI hint**: yes

### Phase 4: Creator Pages
**Goal**: Every creator with an indexed skill has a profile page, a leaderboard home they can appear on, and computed badges they can be proud of.
**Depends on**: Phase 2 (CREATOR-02 "Rising" leaderboard requires DATA-01 `skill_first_commit_at` to identify newest Featured skills)
**Requirements**: CREATOR-01, CREATOR-02, CREATOR-03
**Success Criteria** (what must be TRUE):
  1. User visits `/creators/[username]` for any creator with at least one indexed skill and sees their avatar, GitHub bio, all indexed skills sorted by quality, aggregate stats (total skills, total stars, tier breakdown), and category distribution — with bios cached to `data/creators.json` so builds don't re-fetch every run.
  2. User visits `/creators` and sees four top-10 leaderboards: by Featured count, Prolific (total indexed skills), Quality (average quality score), and Rising (newest Featured using `skill_first_commit_at`).
  3. Creator profile pages display the correct computed badges: Prolific (5+ indexed skills), Quality (all indexed skills are Featured), and Rising (at least one Featured skill with `skill_first_commit_at` in the last 30 days).
  4. Every indexed skill's detail page links to its creator's profile page, and every leaderboard entry links to the matching profile.
**Plans**: TBD
**UI hint**: yes

### Phase 5: Analytics
**Goal**: The operator can see real usage data — visitors, top pages, custom events, and actual search queries — without paying for anything beyond the existing free tier.
**Depends on**: Phase 1 (ANALYTICS-03 search query log targets the Phase 1 rebuilt search input; PostHog `search_query` event fires from the same code path)
**Requirements**: ANALYTICS-01, ANALYTICS-02, ANALYTICS-03
**Success Criteria** (what must be TRUE):
  1. Cloudflare Web Analytics is enabled on claudeatlas.com and the operator can see daily visitors, top pages, referrers, and country breakdown in the Cloudflare dashboard within 24 hours of enabling.
  2. PostHog is loaded on every page via a script tag and fires the six tracked events (`copy_install_command`, `click_github_link`, `search_query`, `category_click`, `view_skill_detail`, `badge_click`) — verifiable by opening the site, clicking through each surface, and seeing the events land in the PostHog live feed.
  3. After a user types in the search input (debounced ~500ms), a row is inserted into a Cloudflare D1 table via a Worker endpoint with `{timestamp, query, ip_hash}` — no raw IPs, no other identifiers.
  4. Everything in this phase stays on the free tier (no paid Cloudflare, no paid PostHog, no paid D1 capacity).
**Plans**: TBD
**UI hint**: no

### Phase 6: Infrastructure Groundwork
**Goal**: ClaudeAtlas publishes a machine-readable catalog that agents can fetch and discover directly, and the README tells them where to find it.
**Depends on**: Nothing hard (can run in parallel with any other phase — pulls from `skills.json` which is stable)
**Requirements**: INFRA-01, INFRA-02
**Success Criteria** (what must be TRUE):
  1. An agent (or `curl`) fetches `https://claudeatlas.com/skills-registry.json` and gets a JSON document shaped `{name, url, generated_at, count, skills[]}` where each skill includes `name, slug, description, category, quality_tier, install_command, repo_url, detail_url`.
  2. The registry's `count` and skill list are regenerated at build time from `data/skills.json` — it never goes stale relative to the curated output.
  3. `README.md` (and/or the methodology page) contains a "For agents" section that explicitly names `/skills-registry.json` as the machine-readable entry point, with an example fetch.
**Plans**: TBD
**UI hint**: no

### Phase 3.0.0: Split-Track Scrape Architecture (INSERTED 2026-04-25)
**Goal**: Daily GHA scrape always completes in <30 min and produces a healthy `data/history/<today>.json` + updated `skills.json`, on free-tier GHA, without breaking existing schemas. Unblocks all Phase 3.0 sub-phases.
**Depends on**: Hard — must ship before any Phase 3.x execution begins. Current single-pass scrape exceeds GitHub's 6h platform cap.
**Requirements**: 3.0.0-DOD-1 through 3.0.0-DOD-7 (see `.planning/phases/3.0.0-split-track-scrape/3.0.0-PLAN.md`)
**Success Criteria** (what must be TRUE):
  1. `scripts/scrape-pulse.js` exists and refreshes 11 fields on every indexed repo daily, writing today's `data/history/<today>.json`.
  2. `scripts/scrape.js` accepts `--mode={incremental,full}`; incremental adds `pushed:>3d` filter, full preserves current behavior.
  3. `scripts/filter.js` preserves Track 1 freshness fields when merging skills-raw.json into skills.json, then re-scores so quality_score reflects fresh stars+recency.
  4. `.github/workflows/daily-scrape.yml` runs Track 1 → Track 2 incremental → full pipeline, completes in <30 min warm.
  5. `.github/workflows/weekly-discover.yml` runs Sundays 03:00 UTC, full Track 2 sweep + full pipeline, never commits raw skills-raw.json.
  6. First post-deploy daily run completes <30 min with all green steps and `≥2` snapshots in `data/history/`.
  7. `CLAUDE.md` and `.planning/codebase/ARCHITECTURE.md` corrected: skills-raw.json is ~295 MB, not ~8 MB.
**Plans**: `3.0.0-PLAN.md` (8 tasks, 5 waves, ~3-3.5 hr execution + human-verify checkpoint)
**UI hint**: no

---

## Progress

**Execution Order:**
Phase 1.5 phases executed in numeric order: 1 → 2 → 3 → 4 → 5 → 6. v2.0 phases 2.1–2.5 executed sequentially. Phase 3.0.0 must complete before any Phase 3.x sub-phase. Phase 3.0 sub-phases (3.1–3.9) follow the session structure in `docs/PHASE-3.0-SPEC.md`.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Content & UX Fixes | 2/2 | Complete | 2026-04-10 |
| 2. Data Moats | 1/1 | Complete (backfill data lands at end of run) | 2026-04-10 |
| 3. Distribution | 1/1 | Complete | 2026-04-10 |
| 4. Creator Pages | 1/1 | Complete | 2026-04-10 |
| 5. Analytics | 1/1 | Code shipped; awaits morning external steps | 2026-04-10 |
| 6. Infrastructure Groundwork | 1/1 | Complete | 2026-04-10 |
| 1.5.1. Creators Browse Page | 1/1 | Complete | 2026-04-13 |
| 2.1. Semantic Search | 1/1 | Complete | 2026-04-13 |
| 2.2–2.5. v2.0 follow-ons | — | Complete with caveats (KV namespace pending; see STATE.md) | 2026-04-13 |
| 3.0.0. Split-Track Scrape | 0/8 | Planned, ready to execute | — |
| 3.1–3.9. Phase 3.0 sub-phases | 0/9 | Planned in spec, await 3.0.0 ship | — |
