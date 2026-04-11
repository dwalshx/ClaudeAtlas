# Phase 2: Data Moats - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous overnight run)

<domain>
## Phase Boundary

Backfill the true creation date for every indexed skill (DATA-01), render two charts on the homepage (DATA-02 new-skills-per-week, DATA-03 active maintenance), and complete the one-time star-history backfill for the top 305 Featured skills (DATA-04).

DATA-04 was already started before Phase 2 began — a separate background job at task `biulifv6k` is fetching `data/star-history.json.partial` right now. When it completes we'll commit the file as-is; no additional work on DATA-04 beyond monitoring.

Out of scope for this phase:
- Scoring changes (any change requires recalibration per CLAUDE.md — explicit guardrail)
- Pagination of the homepage (charts are added; top-60 cap remains)
- Any of the Distribution/Creator/Analytics work
</domain>

<decisions>
## Implementation Decisions

### Data backfill
- DATA-01 backfill script is `scripts/backfill-skill-birth-dates.js`, modeled on `scripts/backfill-star-history.js` (same rate-limit, checkpoint, resume pattern)
- Uses `GET /repos/{owner}/{repo}/commits?path={skill_path}&per_page=1&page=2` to walk to the last page — the earliest commit touching the file. A single `Link` header parse gives us the last page number and we fetch it.
- Writes enriched skills back to `data/skills.json` with a new `skill_first_commit_at` field (ISO 8601) on every skill. Skills where the lookup fails retain the field as `null`.
- Run before the build so the charts have data. The backfill is committed to git as part of the Phase 2 ship.

### Charts
- Both charts render as **inline SVG generated at build time** — no client-side chart library, no external JS. Matches the site's static-site discipline from PROJECT.md constraints.
- Chart width: 720px (fits within max-w-3xl on desktop). Height: 180px for new-skills, 200px for maintenance donut/bar.
- Use existing Tailwind color palette: `atlas-500` for growth, amber for Featured, emerald for Solid, gray for Listed.
- Helper module: `src/lib/charts.js` exports `buildNewSkillsWeekChart(skills)` and `buildMaintenanceChart(skills)` returning SVG strings. Each function is pure — accepts skills array, returns a string.
- DATA-02 (new skills/week) uses `skill_first_commit_at` if available, falling back to `repo_created_at`.
- DATA-03 (maintenance) uses `repo_pushed_at` and buckets into: this week, this month, last 3 months, last 6 months, stale (>6 months).

### Page placement
- Both charts live in a new "Ecosystem Pulse" section on the homepage, placed after the Featured section and before the Top Skills grid. Hidden when search is active (same toggle as Featured).
- Section ID: `ecosystem-section` so the Phase 1 search-filter toggle can hide/show it.
</decisions>

<code_context>
## Existing Code Insights

- `scripts/backfill-star-history.js` — reference implementation for the birth-date backfill
- `scripts/scrape.js` — for rate-limit headers and ETag patterns (not reused directly, but shows the conventions)
- `src/lib/skills.js` — where to add a small helper that loads and exposes the backfilled data
- `src/pages/index.astro` — after Phase 1, has the sticky search + featured-section toggle. Need to add ecosystem-section following the same hide-on-search pattern.
</code_context>

<specifics>
## Specific Ideas

- DATA-02 chart: "New skills per week" bar chart, last 12 months. X axis = week number, Y axis = count. Label the first and last weeks.
- DATA-03 chart: Stacked horizontal bar (not donut) — simpler in raw SVG and reads well on mobile. Bucket colors:
  - This week → `bg-atlas-500` (#ffa500-ish depending on palette)
  - This month → atlas-400
  - Last 3 months → emerald-500
  - Last 6 months → amber-500
  - Stale → gray-600
- Both charts get a small caption below stating the data source and timestamp.
</specifics>

<deferred>
## Deferred Ideas

None — Phase 2 scope is tight.
</deferred>
