# Phase 1.5 Scope

**Status:** Planned
**Target start:** Next work session (fresh context, GSD-managed execution)
**Rough effort:** 10-14 human-equivalent dev hours

## Theme

Phase 1.5 builds on the Phase 1 MVP with four goals:

1. **Fix rough edges** from the Phase 1 ship (search UX, hero stat display)
2. **Start compounding data moats** that become more valuable every day we run them
3. **Add creator visibility** to make ClaudeAtlas a place skill authors feel rewarded to be listed on
4. **Lay groundwork** for Phase 2 work (especially agent discoverability and analytics)

Phase 1.5 does **not** expand to new entity types (plugins, commands, frameworks). It does **not** introduce embeddings or semantic search. It does **not** include auto-notifications to creators or a public query API. Those are all Phase 2.

---

## Already shipped in this session

These landed before Phase 1.5 began (as part of the Phase 1 retrospective push):

- **Daily star snapshots** — `scripts/scrape.js` now writes `data/history/YYYY-MM-DD.json` on every run. First snapshot captured 2026-04-11 with 3,059 repos. Snapshots are committed to the repo. The time-series moat compounds from this date forward.

---

## Scope: Phase 1.5

### 1. Content & UX fixes (quick wins, ~1.5 hours)

#### 1a. Hero stat fix — show the real "analyzed" number

**Current problem:** Homepage shows "1,078 skills analyzed · 305 featured". The true scraped number is 33,078. We're massively underselling the curation story.

**Fix:** Update `src/layouts/BaseLayout.astro` and `src/pages/index.astro` to read `total_discovered` from `data/pipeline-stats.json` and display:

> **33,078 analyzed · 1,078 indexed · 305 featured · Updated daily**

Also update the meta description. Affects: homepage hero, methodology page, any other place the stats appear.

**Effort:** 10-15 minutes.

#### 1b. Search rebuild — "best fix" option

**Current problem:** Search is keyword-only and filters a grid that appears below the Featured section. When typing, results are below the fold. Users can't see what they searched for without scrolling.

**Fix:**
- Sticky header bar with the search input always visible on scroll
- When the search input has any value, hide the Featured Skills section and expand the grid to include all skills (not just top 60)
- Include Featured skills in the filterable dataset so everything searches
- Add a small dropdown below the search input showing top-5 matches as you type (optional nice-to-have; core fix is the sticky + expand)
- Clear search button

Use Pagefind for client-side search (already installed but not wired up) OR stick with the current simple substring filter but fix the UX. Pagefind gives better ranking but adds a build step; substring is simpler and probably fine for 1,078 skills.

**Effort:** 1-2 hours.

---

### 2. Data moats (medium, ~2-3 hours)

These are all "run once against existing data + make a chart" items.

#### 2a. Skill birth date backfill

**Goal:** For each of our 1,078 curated skills, query GitHub's commits API to find the first commit that touched that SKILL.md file path. That's the true "skill creation date," far more accurate than `repo_created_at`.

**How:**
```
GET /repos/{owner}/{repo}/commits?path={skill_path}&per_page=1&page=<last>
```
Getting the *last* page with `per_page=1` returns the earliest commit. Or walk backwards through pages.

**Cost:** 1-2 API calls per skill × 1,078 skills = ~1,500 API calls. Well under 5,000/hour rate limit. ~15-30 minutes wall clock.

**Output:** Add `skill_first_commit_at` field to each skill record. Store in `skills.json`.

#### 2b. New-skills-per-week chart

Using the birth date data from 2a, chart the number of new skills per week over the last 12 months. This is the ecosystem growth curve — a "hockey stick" chart that's directly shareable.

**Implementation:** Either inline SVG generated at build time, or a small client-side chart library (Chart.js, observable-plot, or hand-rolled SVG). Place on the homepage below the Top Skills grid, or on a dedicated `/momentum` page.

#### 2c. Active-maintenance chart

Using existing `repo_pushed_at` data (no new API calls), chart what percentage of indexed skills are actively maintained:
- Updated this week
- Updated this month
- Updated in the last 3 months
- Updated in the last 6 months
- Stale (>6 months)

A simple stacked bar or donut chart. Strong quality signal that no other directory surfaces.

#### 2d. Featured repo star history backfill (overnight)

**Goal:** Get the full star growth trajectory for the top 305 Featured skills' repos.

**How:** Use GitHub's stargazers API with the `Accept: application/vnd.github.v3.star+json` header to get timestamped star events:

```
GET /repos/{owner}/{repo}/stargazers?per_page=100&page=<n>
Accept: application/vnd.github.v3.star+json
```

**Cost:** Paginated at 100 stars per request. 305 repos with average ~1,000 stars each = ~3,000 API requests. About 1 hour of wall clock at the rate limit. Overnight-safe.

**Output:** A new file `data/star-history.json` with `{repo_full_name: [{timestamp, star_count}]}` arrays. This powers the embeddable star history charts (see #3b).

**Important:** This is a one-time backfill. Going forward, the daily snapshots fill in the rest. We only need historical data for the top 305 Featured skills.

---

### 3. Distribution (~1.5 hours)

#### 3a. Tier badge SVG endpoint

**Goal:** Create a static, embeddable SVG badge that skill creators can add to their repo README.

**Example embed:**
```markdown
[![ClaudeAtlas](https://claudeatlas.com/badge/anthropics/skills.svg)](https://claudeatlas.com/skills/anthropics/claude-api/)
```

**Design:** A shields.io-style badge that shows the quality tier with a colored pill:
- Featured → gold/amber background
- Solid → green background
- Listed → gray background

**Implementation:** Generate one SVG per indexed skill at build time. Write to `public/badge/[author]/[skill].svg` so it's served as a static file with edge caching. Each badge links back to the skill detail page with a UTM parameter (`?ref=badge`).

**Effort:** 1 hour.

#### 3b. Star history chart infrastructure (prep only — no data yet)

**Goal:** Build the code path for star history charts even before we have enough data. Once the backfill in 2d completes, charts light up automatically.

**Implementation:**
- `public/badge/[author]/[skill]-history.svg` — a small line chart SVG generated from `data/star-history.json` + `data/history/*.json`
- Gracefully degrades if there's insufficient data ("Not enough history yet" placeholder)
- Same embed pattern as tier badges

**Effort:** 30 minutes if we keep the chart simple (raw SVG, no library).

---

### 4. Creator pages (~3-4 hours — biggest chunk)

#### 4a. Creator profile pages (Layer 1)

**Route:** `/creators/[username]`

**Content:**
- Creator's avatar and bio (fetched from GitHub `/users/{username}` API — 1 call per creator, ~830 creators in current index, ~10 minutes wall clock)
- All their indexed skills in one grid, sorted by quality
- Aggregate stats: total skills, total stars across all skills, tier breakdown
- Link to their GitHub profile
- Category distribution of their skills

**Cache the GitHub user data** in `data/creators.json` so we don't re-fetch on every build.

#### 4b. Creator leaderboards (Layer 2)

**Route:** `/creators` (index page)

**Content:**
- Top 10 creators by Featured skill count
- Top 10 creators by total indexed skills ("Prolific")
- Top 10 creators by average quality score ("Quality")
- Top 10 creators by newest Featured skill ("Rising") — uses the skill birth date data from 2a

Each entry is a card linking to the creator's profile page.

#### 4c. Creator badges (Layer 2)

Small visual badges that appear on creator profile pages:
- **Prolific** — 5+ indexed skills
- **Quality** — all indexed skills are Featured tier
- **Rising** — has a Featured skill created in the last 30 days

Static computation at build time; no user interaction.

**What's explicitly NOT in 1.5 (deferred to Phase 2):**
- ❌ Claim verification (SPDX-style GitHub profile README proof)
- ❌ Custom bios from claimed profiles
- ❌ Creator-of-the-week feature
- ❌ RSS feeds per creator
- ❌ Follow-this-creator mechanism

---

### 5. Analytics (~1 hour)

#### 5a. Cloudflare Web Analytics

Enable it in the Cloudflare Pages / Workers project settings. Zero code change. Gives us daily visitors, top pages, referrers, country breakdown.

**Effort:** 5 minutes in Cloudflare dashboard.

#### 5b. PostHog integration

Add PostHog to the site with a small script tag. Track custom events:
- `copy_install_command` — user clicked the copy button on a skill card
- `click_github_link` — user clicked through to GitHub
- `search_query` — user typed something into the search (also captured to our own log, see 5c)
- `category_click` — user clicked a category chip
- `view_skill_detail` — user viewed a skill detail page (automatic pageview)
- `badge_click` — traffic arriving via the `?ref=badge` UTM parameter

PostHog free tier handles up to 1M events/month. Self-host or use their EU servers to avoid GDPR concerns.

**Effort:** 30-45 minutes.

#### 5c. Search query log

Capture every search query to a persistent log we control. Options:
- **Cloudflare D1** (free SQL database, works natively with Workers) — my recommendation
- **Cloudflare KV** (simpler but less queryable)
- **GitHub Actions + commit to repo** (free but hacky)

Implementation: when user types in the search bar (debounced, after they stop typing for 500ms), POST to a small Cloudflare Worker endpoint that inserts `{timestamp, query, ip_hash}` into D1. Absolutely no PII beyond a hashed IP for dedup.

**Effort:** 30 minutes.

**Why this is worth its own storage:** search queries are the highest-value product data we can collect. Every query is a user telling us "this is what I wanted that you may not have given me." Drives Phase 2 decisions on missing categories, trending topics, and content gaps.

---

### 6. Infrastructure groundwork (~30 min)

#### 6a. skills-registry.json

**Goal:** Publish a machine-readable catalog file that agents can fetch to discover the entire ClaudeAtlas index.

**Location:** `public/skills-registry.json` (becomes `https://claudeatlas.com/skills-registry.json`)

**Format:** Subset of `skills.json` with just the fields agents need:
```json
{
  "name": "ClaudeAtlas",
  "url": "https://claudeatlas.com",
  "generated_at": "2026-04-11T00:00:00Z",
  "count": 1078,
  "skills": [
    {
      "name": "...",
      "slug": "...",
      "description": "...",
      "category": "...",
      "quality_tier": "featured",
      "install_command": "...",
      "repo_url": "...",
      "detail_url": "https://claudeatlas.com/skills/..."
    },
    ...
  ]
}
```

This is the first step of agent discoverability. Phase 2 will build a query API on top; Phase 1.5 just publishes the bulk catalog in a structured form.

**Effort:** 15-30 minutes. Generate at build time from `skills.json` via an Astro endpoint or a post-build script.

#### 6b. Note the commitment in the README

Add a short "For agents" section to the README and/or the methodology page mentioning the registry file. This is discoverable from the outside.

---

## Recommended execution approach

Based on the Phase 1 retrospective lessons:

1. **Fresh session** — don't carry context from the Phase 1 build session
2. **GSD-managed execution** — use `/gsd:plan-phase` and `/gsd:execute-phase` to chunk the work into isolated sub-agent contexts
3. **Orchestrator stays orchestrator** — the main session coordinates and integrates; it does not write code itself
4. **One GSD phase per section above** — Section 1 (content/UX), Section 2 (data moats), Section 3 (distribution), Section 4 (creator pages), Section 5 (analytics), Section 6 (infrastructure). Six phases total.
5. **Section 4 is the riskiest chunk** — plan it carefully and consider splitting into 4a/4b sub-phases

## Ordering (suggested)

**Session A (quick wins, ~2 hours):**
- 1a (hero stat fix)
- 5a (Cloudflare Analytics)
- 6a (skills-registry.json)
- 5c (search query log)
- Kick off 2d (star history backfill) as a background job

**Session B (main work, ~4-6 hours):**
- 1b (search rebuild)
- 2a (skill birth date backfill) + 2b (new-skills chart) + 2c (maintenance chart)
- 3a (tier badges)
- 3b (star history chart infrastructure)
- 5b (PostHog)

**Session C (creator pages, ~3-4 hours):**
- 4a (profile pages)
- 4b (leaderboards)
- 4c (badges)

Can be merged into fewer sessions if context/time allows, but 3 sessions makes sense as a natural split.

---

## What "done" looks like for Phase 1.5

- Hero shows the real "33,078 analyzed" number
- Search works like a normal search should
- Homepage has a "new skills per week" chart and an "active maintenance" donut
- Every skill has an embeddable tier badge available at `/badge/[author]/[skill].svg`
- Every creator has a profile page at `/creators/[username]` with their skills, stats, and bio
- There's a creator leaderboard at `/creators`
- Cloudflare Analytics + PostHog are tracking real usage
- Search queries are being captured to D1
- `/skills-registry.json` publishes a machine-readable catalog
- The daily scrape continues to run (still working), and the `data/history/` directory has multiple days of snapshots by the time this ships
- The star history backfill has completed and `data/star-history.json` exists
- Featured skills have star history charts available (even if thin)

## Success criteria

- User opens https://claudeatlas.com and immediately understands the scale (33k analyzed)
- User searches for "testing" and sees testing skills above the fold, not below
- A creator sees their profile page and feels proud enough to share it
- Tier badges start showing up on featured repos' READMEs (track via PostHog `badge_click` events)
- Phase 1.5 finishes in no more than 3 focused sessions
- No regression in the daily scrape pipeline
- Zero downtime during rollout
