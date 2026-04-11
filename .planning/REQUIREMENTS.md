# Requirements: ClaudeAtlas — Phase 1.5

**Defined:** 2026-04-10
**Core Value:** Users can find the best Claude skill for a given task in under 30 seconds, with visible signals for why it's trustworthy.
**Milestone:** Phase 1.5 — scoped per `docs/PHASE-1.5-SCOPE.md`

Phase 1 requirements shipped 2026-04-10 and are recorded as Validated in `.planning/PROJECT.md`. The v1 requirements below are the Phase 1.5 scope only.

---

## v1 Requirements

Requirements for the Phase 1.5 milestone. Each maps to exactly one roadmap phase.

### Content & UX Fixes

- [ ] **UX-01**: Homepage hero displays the real `total_discovered` number from `data/pipeline-stats.json` (e.g. "33,078 analyzed · 1,078 indexed · 305 Featured · Updated daily") and the same stat is used wherever else it appears (methodology page, meta description)
- [ ] **UX-02**: Search input is pinned in a sticky header bar visible on scroll, with a clear-search button
- [ ] **UX-03**: When the search input has any value, the Featured section is hidden and the results grid expands to include all indexed skills (not just the top 60), so results are visible above the fold
- [ ] **UX-04**: Featured skills are included in the filterable dataset so every indexed skill is reachable via search

### Data Moats

- [ ] **DATA-01**: Every indexed skill has a `skill_first_commit_at` field in `data/skills.json`, populated by querying the GitHub commits API for the earliest commit touching the skill's path
- [ ] **DATA-02**: Homepage (or a dedicated `/momentum` page) renders a "new skills per week" chart over the last 12 months using `skill_first_commit_at`
- [ ] **DATA-03**: A build-time "active maintenance" chart (stacked bar or donut) shows what percentage of indexed skills were updated this week / this month / last 3 months / last 6 months / stale, derived from existing `repo_pushed_at` data
- [ ] **DATA-04**: A one-time star-history backfill for the top 305 Featured skills writes `data/star-history.json` as `{repo_full_name: [{timestamp, star_count}, ...]}` using the GitHub stargazers API with `Accept: application/vnd.github.v3.star+json`

### Distribution

- [ ] **DIST-01**: A static tier-badge SVG is generated for every indexed skill at build time under `public/badge/[author]/[skill].svg`, colored by tier (Featured=gold, Solid=green, Listed=gray), linking back to the skill detail page with `?ref=badge`
- [ ] **DIST-02**: A star-history chart SVG is generated per skill at `public/badge/[author]/[skill]-history.svg` using `data/star-history.json` + `data/history/*.json`, with a graceful "Not enough history yet" fallback when data is thin

### Creator Pages

- [ ] **CREATOR-01**: Every creator with at least one indexed skill has a profile page at `/creators/[username]` showing their avatar, bio (fetched from GitHub `/users/{username}` and cached to `data/creators.json`), all indexed skills sorted by quality, aggregate stats (total skills, total stars, tier breakdown), and category distribution
- [ ] **CREATOR-02**: A `/creators` index page shows four top-10 leaderboards: by Featured count, Prolific (by total indexed skills), Quality (by average score), and Rising (newest Featured, using `skill_first_commit_at` from DATA-01)
- [ ] **CREATOR-03**: Creator profile pages display computed badges — Prolific (5+ indexed skills), Quality (all indexed skills Featured), Rising (Featured skill created in last 30 days)

### Analytics

- [ ] **ANALYTICS-01**: Cloudflare Web Analytics is enabled for the claudeatlas.com site (dashboard toggle, no code change), producing daily visitors / top pages / referrers / country breakdown
- [ ] **ANALYTICS-02**: PostHog is integrated via script tag and tracks custom events: `copy_install_command`, `click_github_link`, `search_query`, `category_click`, `view_skill_detail` (automatic pageview), and `badge_click` (via the `?ref=badge` UTM parameter)
- [ ] **ANALYTICS-03**: Search queries are captured to a persistent Cloudflare D1 log via a small Worker endpoint — `{timestamp, query, ip_hash}`, debounced ~500ms after the user stops typing, with no raw PII

### Infrastructure Groundwork

- [ ] **INFRA-01**: `public/skills-registry.json` (served at `https://claudeatlas.com/skills-registry.json`) publishes a machine-readable catalog at build time, with `{name, url, generated_at, count, skills[]}` containing the agent-relevant subset of each skill: `name, slug, description, category, quality_tier, install_command, repo_url, detail_url`
- [ ] **INFRA-02**: `README.md` and/or the methodology page includes a "For agents" section pointing to `/skills-registry.json` as the machine-readable entry point

---

## v2 Requirements

Deferred to Phase 2+ — tracked in `docs/FUTURE-WORK.md`, not in the Phase 1.5 roadmap.

### Phase 2 — Semantic & expansion
- **SEM-01**: Semantic search and pre-computed similar skills (OpenAI `text-embedding-3-small` + Cloudflare Vectorize)
- **API-01**: Public query API at `/api/v1/search`
- **PLUGIN-01**: Expansion to plugins (`marketplace.json` discovery)
- **FW-01**: Expansion to frameworks/systems
- **GRAPH-01**: API/capability graph dataset
- **FED-01**: `marketplace.json` federation — register ClaudeAtlas as a Claude plugin marketplace
- **ENTITY-01**: Expansion to commands, subagents, MCP servers

### Phase 2.5 — Creator relationships
- **CLAIM-01**: Creator claim verification (SPDX-style GitHub README proof)
- **NOTIFY-01**: Auto-notifications to creators on Featured / trending
- **FOLLOW-01**: Follow-a-creator RSS feeds

### Phase 3 — Editorial
- **EDIT-01**: Skill-of-the-week feature
- **EDIT-02**: "Best Claude Skills for X" article series
- **EDIT-03**: Comparison content
- **EDIT-04**: Creator interview series
- **EDIT-05**: Blog / changelog

### Phase 4+ — Infrastructure & product
- **SUBMIT-01**: Creator submissions flow
- **DASH-01**: Internal analytics dashboard
- **CHANGELOG-01**: Machine-readable `/changelog.json`
- **TRENDS-01**: Historical trend views at `/trends`
- **I18N-01**: Multi-language support
- **EMBED-01**: Embeddable mini-widgets beyond tier badges
- **GQL-01**: GraphQL API

---

## Out of Scope

Explicitly excluded from Phase 1.5 — documented to prevent scope creep during planning and execution.

| Feature | Reason |
|---------|--------|
| Semantic search / embeddings | Pays off at higher scale; blocks Phase 1.5 if rushed. Keyword substring filter is sufficient at 1,078 skills. Deferred to Phase 2. |
| Public query API | Requires semantic search. Deferred to Phase 2. |
| Plugin / framework / command / MCP entity types | Would force data-model churn across scraper, filter, scoring, and pages. Phase 1.5 stays skill-only. Deferred to Phase 2. |
| Creator claim verification | Claim workflow is close to a mini-feature of its own. Deferred to Phase 2.5. |
| Auto-notifications to creators (GitHub issues on Featured) | Risk management (spam detection, tone, false positives) needs its own discussion. Deferred to Phase 2.5. |
| Creator-of-the-week / editorial content | Human-judgment work; automate the data moats first. Deferred to Phase 3. |
| Submissions flow | Deliberately delayed per the Phase 1 Leadership report — curation model needs to be proven before submissions add value. Deferred to Phase 4. |
| Custom CMS / admin UI | Static site + git + daily cron is the operational model. No admin surface in Phase 1.5. |
| Paid tiers / dependencies | Everything must stay on the free tier (domain is the only paid cost). |
| Drifting from calibrated filter rules in `scripts/filter.js` | Any change requires re-validating against `data/skills-raw.json` and comparing distributions. Not in Phase 1.5. |

---

## Traceability

Populated by the roadmapper during Step 8 of `/gsd:new-project`. Each requirement maps to exactly one phase.

| Requirement | Phase | Status |
|-------------|-------|--------|
| UX-01 | TBD | Pending |
| UX-02 | TBD | Pending |
| UX-03 | TBD | Pending |
| UX-04 | TBD | Pending |
| DATA-01 | TBD | Pending |
| DATA-02 | TBD | Pending |
| DATA-03 | TBD | Pending |
| DATA-04 | TBD | Pending |
| DIST-01 | TBD | Pending |
| DIST-02 | TBD | Pending |
| CREATOR-01 | TBD | Pending |
| CREATOR-02 | TBD | Pending |
| CREATOR-03 | TBD | Pending |
| ANALYTICS-01 | TBD | Pending |
| ANALYTICS-02 | TBD | Pending |
| ANALYTICS-03 | TBD | Pending |
| INFRA-01 | TBD | Pending |
| INFRA-02 | TBD | Pending |

**Coverage:**
- v1 requirements: 18 total
- Mapped to phases: 0 (pending roadmap creation)
- Unmapped: 18 ⚠️ (will be resolved by roadmapper)

---
*Requirements defined: 2026-04-10*
*Last updated: 2026-04-10 after Phase 1.5 initialization*
