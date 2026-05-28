# ClaudeAtlas

## What This Is

ClaudeAtlas is a curated discovery index of top Claude ecosystem skills. It automatically discovers SKILL.md files across GitHub, scores them on 7 transparent signals, categorizes them, and publishes a browsable static site at [claudeatlas.com](https://claudeatlas.com). Built for Claude Code users and agent authors who want to find trustworthy, high-quality skills without wading through thousands of repos.

## Core Value

**Users can find the best Claude skill for a given task in under 30 seconds, with visible signals for why it's trustworthy.**

If everything else fails, this must work — the single browse-and-discover loop drives every other decision about moats, creator tools, analytics, and infrastructure.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ GitHub discovery pipeline scrapes SKILL.md files via code search + topic search — Phase 1 (2026-04-10)
- ✓ 7-signal quality composite scoring (stars, recency, frontmatter, docs, issues, license, description) — Phase 1
- ✓ Post-filter rules (10-star floor, 500-char body, slop-name blacklist, per-repo cap, variant dedup) — Phase 1
- ✓ Astro 5 static site with dark theme, homepage, category pages, skill detail pages — Phase 1
- ✓ Cloudflare Workers Static Assets hosting with custom domain and SSL — Phase 1
- ✓ Daily GitHub Actions cron that scrapes, filters, builds, deploys, commits `data/skills.json` — Phase 1
- ✓ Public methodology page — Phase 1
- ✓ Daily star snapshots to `data/history/YYYY-MM-DD.json` (time-series moat starts compounding) — Phase 1 retrospective push
- ✓ ETag cache for cheap re-scrapes (~5-10 min after first full run) — Phase 1

### Active

<!-- Phase 1.5 milestone — scoped in docs/PHASE-1.5-SCOPE.md. -->

**Content & UX fixes**
- [ ] Homepage hero shows the real "33,078 analyzed" number, not just the indexed count
- [ ] Search UX rebuilt — sticky header bar, filters expanded dataset (not just top 60), visible without scrolling

**Data moats**
- [ ] Skill first-commit-date backfill (true creation date, not `repo_created_at`)
- [ ] New-skills-per-week growth chart using backfilled dates
- [ ] Active-maintenance chart (stacked/donut by last-push freshness) from existing data
- [ ] Featured repo star-history backfill (one-time, top 305 Featured skills)

**Distribution**
- [ ] Per-skill tier badge SVG endpoint at `/badge/[author]/[skill].svg` (shields.io style)
- [ ] Star history chart SVG infrastructure (prep path, degrades gracefully until data populates)

**Creator pages**
- [ ] Creator profile page at `/creators/[username]` — bio, avatar, all indexed skills, aggregate stats
- [ ] Creator leaderboard at `/creators` — by Featured count, Prolific, Quality, Rising
- [ ] Creator badges — Prolific (5+), Quality (all Featured), Rising (Featured in last 30d)

**Analytics**
- [ ] Cloudflare Web Analytics enabled (zero code)
- [ ] PostHog integration tracking custom events (copy, github click, search, category, badge click)
- [ ] Search query log persisted to Cloudflare D1 via a small Worker endpoint

**Infrastructure / agent discoverability**
- [ ] `/skills-registry.json` published at build time — machine-readable catalog for agents
- [ ] README "For agents" section pointing to the registry

### Out of Scope

<!-- Phase 1.5 boundaries. Items below are captured in docs/FUTURE-WORK.md for later. -->

- **Semantic search / embeddings** — Phase 2 item. Keyword substring search is fine for 1,078 skills; embeddings pay off at higher scale and unlock the query API.
- **Public query API** — Phase 2. Requires semantic search as a prerequisite.
- **Plugin / framework / command / MCP server entity types** — Phase 2+. ClaudeAtlas stays skill-only for Phase 1.5 to avoid data-model churn.
- **API/capability graph** — Phase 2. Novel but expensive; defer until the simpler moats are in.
- **marketplace.json federation** — Phase 2. Spec was still evolving at Phase 1 ship time; wait for stabilization.
- **Creator claim verification (SPDX-style GitHub README proof)** — Phase 2.5. Workflow is close to a mini-feature of its own.
- **Auto-notifications to creators (GitHub issues on Featured)** — Phase 2.5. Risk management (spam detection, tone, false positives) needs its own discussion.
- **Creator-of-the-week / editorial content** — Phase 3. Human-judgment work; automate the data moats first.
- **Skill-of-the-week, comparison articles, interview series, blog** — Phase 3.
- **Submissions flow** — Phase 4. Deliberately delayed per the Phase 1 Leadership report: "don't add submissions before the curation model is proven."
- **Internal analytics dashboard / GraphQL API / multi-language / embeddable mini-widgets** — Phase 4+.

## Context

**Phase 1 shipped on 2026-04-10** with 33,078 skills scraped, 1,078 curated and indexed (305 Featured, the rest Solid/Listed). Live at claudeatlas.com on Cloudflare Workers Static Assets with the custom domain and SSL configured.

**Phase 3.1 shipped on 2026-05-27 — the comprehensive-index pivot landed.** Catalog grew from 1,286 → 35,341 canonical skills (28× growth). Editorial gates (MAX_PER_REPO, MIN_STARS) dropped; embedding-based dedup at cosine ≥ 0.92 flagged 6,396 duplicates (17.8%) across 3,474 clusters. Percentile-based tier assignment landed clean (3,534 Featured = 10% of catalog). Path-aware slug fix resolved ~402 collisions with worker-side 301 redirects. Live semantic search at `/api/v1/search`; `/browse` page provides SEO link distribution; `/skills-registry.json` carries the renderable subset + `bulk_download_url` for full-catalog consumers. Six PRs shipped — the original plan plus five follow-ups handling deploy-cascade bugs as they surfaced. Two postbuild guards (asset size + file count) now protect against future drift. See `.planning/phases/3.1-filter-overhaul/3.1-SUMMARY.md` for the full retrospective.

**Phase 3.1.2 ready-to-merge 2026-05-28 — polymorphic envelope.** The data-model reshape that unblocks plugins/MCPs/frameworks landed on a 14-commit feature branch. `EntityRecord` discriminated union (6 entity_types) replaces flat `SkillRecord`; tag-based categorization (`category:*`, `framework:*`, `integration:*`, `language:*`, `source:*` namespaces) replaces the rigid `category` enum; type-aware scoring/filter/recipe registries make Phase 3.2 (plugin scoring) a "add files, don't refactor" exercise. Vectorize metadata gains `entity_type` for the tier+category+type filter triad in `/api/v1/search`. Cutover happens automatically on the first post-merge daily-scrape (Filter step writes v2 NDJSON natively, dual-read upcaster handles existing v1 records, content_sha invariance preserves 35k Vectorize index — no re-upload). D+7 cleanup PR removes the legacy upcaster (~2026-06-04). See `.planning/phases/03.1.2-polymorphic-envelope/3.1.2-SUMMARY.md` for the full record.

**Cost ceiling updated in Phase 3.1 (2026-05-26):** ~$102/year (was $12/yr through Phase 2.x). Catalog growth blew past the Cloudflare KV free-tier daily write cap (1k writes/day vs ~21k needed for Listed-tier publish). Upgraded to Workers Paid ($5/mo = $60/yr) for 1M KV writes/day; Vectorize stored-dim overage adds ~$30/yr at 55M dims for the 35k catalog. Speed-to-comprehensive-index was the explicit trade-off.

**Stack (locked from Phase 1):**
- Scraper: Node.js (`scripts/scrape.js`) + GitHub REST API, ETag-cached, resilient checkpoint saves
- Filter: Node.js (`scripts/filter.js`), sub-second on the full raw dataset
- Site: Astro 5 + Tailwind + `@astrojs/sitemap`, fully static build
- Hosting: Cloudflare Workers Static Assets via `wrangler.toml`, custom domain
- Cron: GitHub Actions `daily-scrape.yml` at 6:30 AM UTC, commits back to main
- Data format: `data/skills.json` (curated output, committed), `data/skills-raw.json` (full raw, gitignored), `data/history/YYYY-MM-DD.json` (daily snapshots, committed)

**Key Phase 1 retrospective lessons (relevant to Phase 1.5 execution):**
- Phase 1 was built in one long Org OS session — retrospective flagged this as risky for context continuity. Phase 1.5 should use GSD with fresh session per phase, and the orchestrator should coordinate rather than write code itself.
- Initial scoring calibration had ~18k skills hitting Featured tier. Filter rules were tuned over multiple iterations to land at the current 305 Featured. **Do not drift from current filter settings without re-validating against real data.**
- Daily star snapshots are load-bearing for the moat. Any day the scraper doesn't run is genuinely lost data.
- Homepage shows only top 60 skills for performance; full catalog is browsable via category pages. Search rebuild (Phase 1.5) must expand the filterable dataset to all indexed skills.

**Known operational issues:**
- ETag cache is ~500 MB (gitignored). Fresh clones take ~7 hours for the first scrape; subsequent runs are 5-10 min.
- Scraper hits occasional socket errors on very long runs; retry + checkpoint-at-1000 logic is in place.
- Scoring was last calibrated 2026-04-10. Any changes to signals or weights require re-validation against `data/skills-raw.json`.

**Repo layout:** See `CLAUDE.md` in the project root for the authoritative file-by-file structure and data model. It is kept in sync with reality and is the single source of truth for downstream GSD agents reading project context.

## Constraints

- **Tech stack:** Astro 5 + Cloudflare Workers Static Assets — locked. Do not swap renderers or hosts.
- **Cost ceiling (Phase 3.1+):** ~$102/year — $12 domain + ~$60 Cloudflare Workers Paid + ~$30 Vectorize stored-dim overage. Increased from $12/yr in Phase 3.1 ship (2026-05-26) to support the 35k+ canonical-skill catalog. Any future cost increase beyond ~$102/yr (Vectorize query overage from >50M dims/mo, paid analytics, paid D1 capacity, GitHub Actions paid minutes) requires explicit approval. Optimization opportunity tracked in backlog: drop OpenAI `dimensions` to 512 (truncated embeddings, ~95% retrieval quality) to bring Vectorize storage under the 5M included → saves ~$30/yr.
- **Scraper footprint:** GitHub API rate limit is 5,000 requests/hour with a PAT. Any Phase 1.5 feature that needs backfill (skill birth dates, star history) must fit inside the rate limit with room for the daily cron.
- **Data integrity:** Do not drift from the calibrated filter rules in `scripts/filter.js` without re-running against `skills-raw.json` and comparing the before/after distributions.
- **Deployment:** Zero-downtime rollout is mandatory. The live site must keep serving through every Phase 1.5 deploy.
- **Privacy:** Any analytics/search logging must hash or omit PII. Search query log uses hashed IP for dedup only; no raw identifiers.
- **Static-site discipline:** Wherever possible, compute at build time and serve static files. Cloudflare Workers endpoints are allowed for the search query log (D1 insert) but should not be used for anything that can be baked.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Phase 1.5 milestone scope locked to PHASE-1.5-SCOPE.md (6 sections) | Scope doc is already well-considered; additional Phase 2 items (semantic search, plugins, API) are explicitly deferred to protect focus. | — Pending |
| One GSD phase per scope-doc section | Matches the doc's own execution recommendation; keeps phases independently plannable and verifiable. | — Pending |
| Substring keyword search (not Pagefind) for Phase 1.5 search rebuild | Simpler, no build-step cost, fine at 1,078-skill scale. Pagefind/embeddings are Phase 2. | — Pending |
| Cloudflare D1 for search query log (not KV, not GitHub Actions commits) | Free tier is generous, queryable SQL, native to the Workers stack we already use. | — Pending |
| Daily star snapshots are load-bearing for the moat and cannot regress | The time-series dataset compounds every day and can never be retroactively replicated. | ✓ Good |
| Skip embeddings in Phase 1.5 | At 1,078 skills, keyword search is sufficient; embeddings pay off later and belong with the query API. | — Pending |
| Do not expand to plugins/frameworks/commands/MCP in Phase 1.5 | Data-model churn would block everything else. Stay skill-only. | — Pending |
| Use GSD (not Org OS) for Phase 1.5 execution | Phase 1 retrospective: long single-session Org OS runs strain context. GSD's phase isolation + planner/checker loop fits better. | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-10 after initialization (Phase 1.5 milestone)*
