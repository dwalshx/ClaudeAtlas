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

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6. Phase 6 can optionally run in parallel with any earlier phase since it only reads `skills.json`. Phases 3 and 4 have hard dependencies on Phase 2 outputs.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Content & UX Fixes | 2/2 | Complete | 2026-04-10 |
| 2. Data Moats | 1/1 | Complete (backfill data lands at end of run) | 2026-04-10 |
| 3. Distribution | 1/1 | Complete | 2026-04-10 |
| 4. Creator Pages | 1/1 | Complete | 2026-04-10 |
| 5. Analytics | 1/1 | Code shipped; awaits morning external steps | 2026-04-10 |
| 6. Infrastructure Groundwork | 1/1 | Complete | 2026-04-10 |
