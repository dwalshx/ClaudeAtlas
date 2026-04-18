# Codebase Structure

**Analysis Date:** 2026-04-14

## Directory Layout

```
ClaudeAtlas/
├── CLAUDE.md                     # Session orientation — authoritative project context
├── PHASE-1.5-MORNING.md          # Transient checklist for activating KV + other morning tasks
├── README.md                     # Public-facing intro
├── package.json                  # npm scripts + prebuild chain
├── package-lock.json
├── astro.config.mjs              # Astro 5 — static output, tailwind + sitemap integrations
├── tailwind.config.mjs           # Dark theme, custom `atlas` palette
├── tsconfig.json                 # TS config (Astro-managed)
├── wrangler.toml                 # Worker + ASSETS + D1 + Vectorize + (planned) KV bindings
│
├── .github/workflows/
│   └── daily-scrape.yml          # Cron + manual + push-triggered pipeline
│
├── .planning/                    # GSD workspace (this doc's home)
│   ├── PROJECT.md
│   ├── REQUIREMENTS.md
│   ├── ROADMAP.md
│   ├── STATE.md
│   ├── config.json
│   ├── codebase/                 # Codebase maps (this file)
│   ├── debug/
│   └── phases/
│
├── docs/
│   └── PHASE-3.0-SPEC.md         # "Comprehensive Agent Tooling Index" spec
│
├── scripts/                      # Data pipeline — standalone Node ESM scripts
├── src/                          # Astro site source
│   ├── layouts/
│   ├── components/
│   ├── pages/
│   └── lib/
├── worker/                       # Cloudflare Worker source
│   ├── index.js                  # Worker entry — /api/v1/search + /api/log-search + ASSETS fallthrough
│   └── schema.sql                # D1 schema for search_events
│
├── data/                         # Pipeline output (mixed committed/gitignored)
├── public/                       # Static assets served from /
├── dist/                         # Astro build output (gitignored)
└── node_modules/
```

## Directory Purposes

**`scripts/`:**
- Purpose: Data pipeline. All scrape / transform / compute / generate scripts.
- Contains: 19 standalone Node ESM scripts — no shared runtime, each one reads JSON, writes JSON.
- Key files: See file inventory below.

**`src/`:**
- Purpose: Astro site source. Build-time only — nothing in `src/` runs at request time.
- Contains: `layouts/`, `components/`, `pages/`, `lib/` — standard Astro layout.

**`src/pages/`:**
- Purpose: One file per route (directory-routed). `[...slug]` / `[param]` files use `getStaticPaths()` to enumerate all dynamic URLs at build.
- Contains: Homepage, methodology, 404, plus the `skills/`, `category/`, `creators/`, `apis/` routes.

**`src/components/`:**
- Purpose: Reusable `.astro` components, all build-time rendered.
- Contains: `SkillCard.astro`, `QualityBadge.astro`, `CategoryChip.astro`, `CopyButton.astro`, `ScoreBar.astro`.

**`src/layouts/`:**
- Purpose: Site-wide HTML shell.
- Contains: `BaseLayout.astro` only.

**`src/lib/`:**
- Purpose: Data loader + shared helpers for Astro pages.
- Contains: `skills.js` (data access), `charts.js` (SVG chart builders), `analytics.js` (client-side telemetry wiring).

**`worker/`:**
- Purpose: Cloudflare Worker source — the *only* runtime compute in the system.
- Contains: `index.js` (router + two handlers), `schema.sql` (D1 schema — apply with `wrangler d1 execute`).

**`data/`:**
- Purpose: Pipeline output. Mix of committed and gitignored files. The committed files are part of the repo because they feed `astro build`.
- Contains: see detailed inventory below.

**`data/history/`:**
- Purpose: Tiny per-day `{stars, forks, issues, pushed_at}` snapshots. Pure append. Committed.
- Contains: `YYYY-MM-DD.json` files, one per successful scrape day.

**`public/`:**
- Purpose: Static assets copied verbatim to `dist/`.
- Contains: `favicon.*`, `robots.txt`, `llms.txt`, plus generated `badge/` tree and `skills-registry.json` (both gitignored, rebuilt each build).

**`.github/workflows/`:**
- Purpose: CI orchestration.
- Contains: `daily-scrape.yml` only. This file is the canonical ordering of the pipeline — it is authoritative over `npm run pipeline`.

**`.planning/`:**
- Purpose: GSD workspace (NOT checked into source-control policy per `CLAUDE.md` methodology notes — but actually committed here).
- Contains: Roadmap, requirements, phase plans, codebase maps (this directory).

**`docs/`:**
- Purpose: Long-form specs and scope documents.
- Contains: `PHASE-3.0-SPEC.md` (plugin tooling index spec).

## Per-File Inventory

### Pipeline scripts (`scripts/`)

| File                                  | Role                                                                                                                                      |
|---------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/scrape.js`                   | GitHub discovery (code-search + topics + seed) + metadata + SKILL.md fetch. Writes `skills-raw.json`, `etag-cache.json`, `pipeline-stats.json`, `data/history/<today>.json`. |
| `scripts/parse-skill.js`              | YAML frontmatter + markdown body parser. Imported by `scrape.js`.                                                                          |
| `scripts/score.js`                    | 7-signal quality composite (0-100). Imported by `scrape.js`.                                                                               |
| `scripts/categorize.js`               | Keyword-based 8-category assignment. Imported by `scrape.js`.                                                                              |
| `scripts/filter.js`                   | Post-process: slop removal, dedup, per-repo cap, tier recalibration. Reads `skills-raw.json` → writes `skills.json` + `pipeline-stats.json`. |
| `scripts/embed-skills.js`             | Delta-aware OpenAI `text-embedding-3-small` embeddings. Reads `skills.json` + prior `skill-vectors.ndjson`, only re-embeds changed skills. |
| `scripts/upload-vectors.js`           | Upserts `skill-vectors.ndjson` into Cloudflare Vectorize via REST.                                                                         |
| `scripts/compute-similar.js`          | Cosine-similarity top-5 per skill from embeddings. Writes `similar-skills.json`.                                                           |
| `scripts/compute-clusters.js`         | k-means over embeddings → `skill-clusters.json`. **Not currently wired into any pipeline.**                                                |
| `scripts/mine-apis.js`                | Regex + allow-list API/service detection. Writes `api-graph.json`.                                                                         |
| `scripts/generate-badges.js`          | Produces `public/badge/[author]/[skill].svg` + `[skill]-history.svg`. Reads `skills.json` + `star-history.json`.                           |
| `scripts/generate-registry.js`        | Produces `public/skills-registry.json` for agents.                                                                                         |
| `scripts/generate-marketplace.js`     | Produces `public/marketplace.json` (Featured plugins, `.claude-plugin/marketplace.json`-shaped).                                            |
| `scripts/backfill-skill-birth-dates.js` | One-shot: fill `skill_first_commit_at` on every skill via GitHub commits API. Not in CI.                                                 |
| `scripts/backfill-star-history.js`    | One-shot: fetch full stargazer history for Featured-tier repos. Not in CI.                                                                 |
| `scripts/scrape-plugins.js`           | Research-only: plugin / marketplace.json discovery for Phase 3.0. Writes `plugins-raw.json`. No downstream consumer yet.                   |
| `scripts/*.log`                       | Gitignored stdout/stderr from long-running scripts.                                                                                        |

### Astro pages (`src/pages/`)

| File                                    | Route                                                                       | Data                                                                 |
|-----------------------------------------|-----------------------------------------------------------------------------|----------------------------------------------------------------------|
| `src/pages/index.astro`                 | `/`                                                                         | Homepage — hero stats, search, categories, top 60 skills, SVG charts. |
| `src/pages/methodology.astro`           | `/methodology/`                                                             | Scoring methodology + agent-facing links.                            |
| `src/pages/404.astro`                   | `/404/`                                                                     | Static 404 — served by Workers Static Assets `not_found_handling = "404-page"` (`wrangler.toml:11`). |
| `src/pages/skills/[...slug].astro`      | `/skills/<author>/<skill>/`                                                 | Per-skill detail page. `getStaticPaths()` enumerates every skill.    |
| `src/pages/category/[category].astro`   | `/category/<slug>/`                                                         | Per-category listing.                                                |
| `src/pages/apis/index.astro`            | `/apis/`                                                                    | API graph overview, services grouped by category.                    |
| `src/pages/apis/[service].astro`        | `/apis/<service-id>/`                                                       | Per-service detail, lists skills integrating that service.           |
| `src/pages/creators/index.astro`        | `/creators/`                                                                | Four top-10 leaderboards.                                            |
| `src/pages/creators/all.astro`          | `/creators/all/`                                                            | Full sortable/filterable table (Phase 1.5.1).                        |
| `src/pages/creators/[username].astro`   | `/creators/<username>/`                                                     | Per-creator profile.                                                 |

### Components (`src/components/`)

| File                                    | Purpose                                                                 |
|-----------------------------------------|-------------------------------------------------------------------------|
| `src/components/SkillCard.astro`        | Card for skill listings (homepage, category, creator, similar, search). |
| `src/components/QualityBadge.astro`     | Tier indicator (Featured / Solid / Listed).                             |
| `src/components/CategoryChip.astro`     | Category pill with count.                                               |
| `src/components/CopyButton.astro`       | One-click install-command copy button.                                  |
| `src/components/ScoreBar.astro`         | 7-signal quality breakdown bar.                                         |

### Layouts (`src/layouts/`)

- `src/layouts/BaseLayout.astro` — HTML shell, nav, footer, SEO meta, PostHog init.

### Libs (`src/lib/`)

- `src/lib/skills.js` — Data access for every page. Imports `data/skills.json`, `data/pipeline-stats.json`, soft-loads `data/similar-skills.json` + `data/api-graph.json`. Provides: `allSkills`, `getFeaturedSkills`, `getSkillsByCategory`, `getSkillBySlug`, `getAllCategories`, `getCategorySlug`/`getCategoryFromSlug`, `getStats`, `getPipelineStats`, `getCreators`, `getCreatorByUsername`, `getCreatorLeaderboards`, `getCreatorsForBrowse`, `getRelatedSkills`, `getApiGraph`, `getAllServices`, `getServiceById`, `getSkillIntegrations`, `getSimilarSkills`, `timeAgo`, `tierColor`, `categoryColor`.
- `src/lib/charts.js` — Pure SVG chart builders for the homepage: `buildNewSkillsWeekChart`, `buildMaintenanceChart`. No client JS.
- `src/lib/analytics.js` — PostHog event wiring (loaded client-side).

### Worker (`worker/`)

- `worker/index.js` — `fetch()` default export routes `/api/log-search`, `/api/v1/search`, otherwise `env.ASSETS.fetch(request)`. Handlers: `logSearch`, `semanticSearch`, helpers: `embedQuery`, `sha256Hex`, `queryCacheKey`, `jsonResponse`, `corsPreflightResponse`.
- `worker/schema.sql` — D1 `search_events` table + two indexes (`timestamp`, `query`).

### Data (`data/`) — committed vs gitignored

| File                                       | Committed? | Writer                                      | Why                                            |
|--------------------------------------------|------------|---------------------------------------------|------------------------------------------------|
| `data/skills.json`                         | Yes        | `scripts/filter.js:237`                     | Imported at build time by `src/lib/skills.js:9`. |
| `data/pipeline-stats.json`                 | Yes        | `scripts/filter.js:251`, `scrape.js:696`    | Imported at build time.                        |
| `data/similar-skills.json`                 | Yes        | `scripts/compute-similar.js:127`            | Read by skills.js at build time.               |
| `data/api-graph.json`                      | Yes        | `scripts/mine-apis.js:275`                  | Read by skills.js at build time.               |
| `data/skill-vectors.ndjson`                | Yes        | `scripts/embed-skills.js:218`               | Acts as the delta cache — committing it makes each CI run incremental. |
| `data/star-history.json`                   | Yes        | `scripts/backfill-star-history.js:261`      | One-shot backfill, consumed by `generate-badges.js`. |
| `data/skill-clusters.json`                 | Yes        | `scripts/compute-clusters.js:293`           | Committed but unused by site (see ARCHITECTURE.md discrepancies). |
| `data/history/YYYY-MM-DD.json`             | Yes        | `scripts/scrape.js:243`                     | Daily scrape snapshots, append-only moat.      |
| `data/plugins-raw.json`                    | Yes (currently) | `scripts/scrape-plugins.js:446`        | Exploratory — no consumer.                     |
| `data/skills-raw.json`                     | **No** (`.gitignore:31`) | `scripts/scrape.js:664`       | ~8 MB raw scraper output, rebuilt each run.    |
| `data/etag-cache.json`                     | **No** (`.gitignore:33`) | `scripts/scrape.js:198`       | ~500 MB; persisted via `actions/cache`.        |
| `data/scrape-log.txt`                      | **No** (`.gitignore:34`) | `scrape.js` stdout              | Noisy.                                         |
| `data/skills.json.partial`                 | **No** (`.gitignore:32`) | Scraper checkpoint              | Transient resume state.                        |
| `data/star-history.json.partial`           | **No** (`.gitignore:35`) | backfill-star-history checkpoint | Transient.                                    |
| `data/skills.json.birth-partial`           | **No** (`.gitignore:37`) | backfill-skill-birth-dates checkpoint | Transient.                                |
| `data/plugins-raw.json.partial`            | **No** (`.gitignore:49`) | scrape-plugins checkpoint     | Transient.                                     |

### Public (`public/`)

| File                                           | Committed?    | Writer                                  |
|------------------------------------------------|---------------|-----------------------------------------|
| `public/favicon.ico`, `public/favicon.svg`     | Yes           | Manual.                                 |
| `public/robots.txt`                            | Yes           | Manual.                                 |
| `public/llms.txt`                              | Yes           | Manual.                                 |
| `public/marketplace.json`                      | Yes           | `scripts/generate-marketplace.js:117`. Committed because it's occasionally served as the federation entry point and nice to have in history. |
| `public/skills-registry.json`                  | **No** (`.gitignore:43`) | `scripts/generate-registry.js:103`. Rebuilt each build. |
| `public/badge/[author]/[skill].svg`            | **No** (`.gitignore:41`) | `scripts/generate-badges.js:283`. Rebuilt each build.   |
| `public/badge/[author]/[skill]-history.svg`    | **No** (`.gitignore:41`) | `scripts/generate-badges.js:302`.                       |

## Naming Conventions

**Files:**
- Pipeline scripts: `kebab-case.js` (`compute-similar.js`, `generate-badges.js`, `backfill-star-history.js`).
- Astro pages: `lowercase.astro` or `[param].astro` or `[...slug].astro` (Astro standard).
- Astro components: `PascalCase.astro` (`SkillCard.astro`, `QualityBadge.astro`).
- Layouts: `PascalCase.astro` (`BaseLayout.astro`).
- Libs: `lowercase.js` (`skills.js`, `charts.js`, `analytics.js`).
- Data: `kebab-case.json` / `kebab-case.ndjson`.

**Directories:**
- All `lowercase` or `kebab-case` (`scripts/`, `src/pages/`, `data/history/`, `.github/workflows/`).

**JS / Astro identifiers:**
- Functions: `camelCase` (`getFeaturedSkills`, `writeHistorySnapshot`).
- Constants: `SCREAMING_SNAKE_CASE` at module scope (`SEARCH_DEFAULT_K`, `MAX_QUERY_LEN`, `EMBEDDING_DIMENSIONS`, `MS_PER_DAY`).
- Internal module state: `__double_underscore` (`__skills_dirname`, `__similar_path`, `__api_graph_path` in `src/lib/skills.js:16-29`).

**Slugs:**
- Skill slug: `<author>/<skill-name>` (e.g. `microsoft/code-review`). Path-naive today — the Phase 1.5.2 backlog notes slug collisions (`ROADMAP.md:39`).
- Category slug: lowercase, `&` → `and`, non-alphanumerics → `-`, collapse (`src/lib/skills.js:67-73`).

**Data field conventions:**
- Every skill timestamp in ISO 8601 (`repo_created_at`, `repo_pushed_at`, `skill_first_commit_at`).
- Daily history snapshots use short keys (`s`, `f`, `i`, `p`) to keep file size tiny — see `scrape.js:228-233` and CLAUDE.md.

## Where to Add New Code

**New data producer (scraper, transformer, generator):**
- Primary code: `scripts/<verb>-<noun>.js` (e.g. `scripts/mine-<thing>.js`, `scripts/generate-<thing>.js`, `scripts/compute-<thing>.js`, `scripts/backfill-<thing>.js`).
- Read from: `data/skills.json` (and `data/skill-vectors.ndjson` if semantic).
- Write to: `data/<thing>.json` if site-consumed, `public/<thing>.json` if externally served.
- Wire into: `package.json:17` `prebuild` if the site needs it at build time, or `.github/workflows/daily-scrape.yml` if it needs to run before the build begins.
- Add `npm run <verb>` script to `package.json:6-22` to match existing convention.

**New site page:**
- Static route: `src/pages/<name>.astro`.
- Dynamic route: `src/pages/<parent>/[param].astro` with a `getStaticPaths()` that enumerates from `src/lib/skills.js` helpers.
- Use `BaseLayout.astro`, reuse existing components from `src/components/`.
- Add data helpers to `src/lib/skills.js` (soft-load any new JSON with `existsSync` + `try/catch` so cold first-builds still succeed).

**New component:**
- `src/components/PascalCase.astro`. Keep it Astro-only (no React/Svelte) — the Tailwind + Astro-only stack is locked per `CLAUDE.md` constraints.

**New Worker endpoint:**
- Add handler to `worker/index.js`, register in the `fetch` dispatcher at `worker/index.js:323-345`.
- Declare any new binding in `wrangler.toml` (e.g. a second D1 table, a second KV namespace).
- Set secrets with `wrangler secret put <NAME>` — never commit them.

**New CI step:**
- Add to `.github/workflows/daily-scrape.yml`. Match existing guards:
  - `if: github.event_name != 'push'` for scrape-related steps (push-triggered runs skip scrape).
  - `if: always()` for steps that must run even on cancel/timeout (e.g. cache saves, partial commits).

**New phase docs:**
- Add phase plan under `.planning/phases/`.
- Update `.planning/ROADMAP.md` checklist.

## Special Directories

**`dist/`:**
- Purpose: `astro build` output. Deployed by Wrangler (`wrangler.toml:9-12`).
- Generated: Yes. Committed: **No** (`.gitignore:5`).

**`node_modules/`:**
- Purpose: npm dependencies. Committed: No.

**`data/history/`:**
- Purpose: Append-only daily star snapshots. Each file is ~100-225 KB.
- Generated: Yes (`scripts/scrape.js:243`). Committed: **Yes** — this is the moat. One file per successful scrape day.

**`public/badge/`:**
- Purpose: Generated SVG badge tree, one pair per skill.
- Generated: Yes (`scripts/generate-badges.js`). Committed: **No** (`.gitignore:41`). Rebuilt each build.

**`.planning/`:**
- Purpose: GSD workspace (this file's home).
- Committed: Yes (in this repo — override from the generic GSD convention).

---

*Structure analysis: 2026-04-14*
