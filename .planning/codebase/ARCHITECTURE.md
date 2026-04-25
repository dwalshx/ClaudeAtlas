# Architecture

**Analysis Date:** 2026-04-14

## Pattern Overview

**Overall:** Static-site-first with a thin edge Worker for two dynamic endpoints.

**Key Characteristics:**
- **Build-time heavy.** Every page except two API routes is pre-rendered at build time (`astro.config.mjs:8` → `output: 'static'`).
- **JSON-as-database.** The pipeline writes flat JSON files under `data/`; Astro imports them at build time; pages are statically generated from that snapshot.
- **Daily cron is the refresh mechanism.** No runtime database for content. Content freshness is a function of the last cron run (`.github/workflows/daily-scrape.yml:4-5`, cron `30 6 * * *`).
- **Edge compute only where static fails.** The Worker (`worker/index.js`) handles only `/api/log-search` (telemetry) and `/api/v1/search` (semantic search) — everything else falls through to `env.ASSETS.fetch` (`worker/index.js:340-342`).

## Layers

**Data pipeline (`scripts/`):**
- Purpose: Discover, enrich, score, enrich-again, and transform skill data into the JSON bundle consumed by the site.
- Location: `scripts/*.js`
- Contains: 19 Node ESM scripts (standalone, no shared runtime — each reads/writes JSON under `data/` or `public/`).
- Depends on: GitHub REST API, OpenAI embeddings API, Cloudflare Vectorize REST API.
- Used by: `.github/workflows/daily-scrape.yml`, `npm run pipeline`, `npm run prebuild`.

**Shared site helpers (`src/lib/`):**
- Purpose: Load the generated JSON once at build time and expose query helpers to Astro pages.
- Location: `src/lib/skills.js`, `src/lib/charts.js`, `src/lib/analytics.js`
- Contains: `allSkills` (imported JSON), creator aggregation (`getCreators`, `getCreatorLeaderboards`, `getCreatorsForBrowse`), API graph lookups (`getApiGraph`, `getAllServices`, `getSkillIntegrations`), similar skills (`getSimilarSkills`), SVG chart builders (`buildNewSkillsWeekChart`, `buildMaintenanceChart`).
- Depends on: `data/skills.json` (hard import — build fails without it), `data/pipeline-stats.json` (hard import), `data/similar-skills.json` and `data/api-graph.json` (soft — `existsSync` guarded, `skills.js:19-36`).
- Used by: every `.astro` page.

**Astro pages (`src/pages/`):**
- Purpose: Generate static HTML for every route.
- Location: `src/pages/*.astro` and dynamic routes `skills/[...slug].astro`, `category/[category].astro`, `creators/[username].astro`, `apis/[service].astro`.
- Contains: Frontmatter Astro scripts that call `getStaticPaths()` to enumerate all skill/creator/service URLs, plus Tailwind-styled templates.
- Depends on: `src/lib/skills.js` and `src/components/*.astro`.
- Used by: `astro build` → `dist/`.

**Edge Worker (`worker/index.js`):**
- Purpose: Run the two routes that can't be precomputed (query-time embedding + Vectorize lookup, D1 writes).
- Location: `worker/index.js` (single file, ~350 lines).
- Depends on: Cloudflare bindings `ASSETS`, `DB` (D1), `VECTORIZE`, `QUERY_CACHE` (KV — optional); secrets `OPENAI_API_KEY`, `SALT_SECRET`.
- Used by: Runtime HTTP requests. Dispatch happens in `worker/index.js:323-345`.

**Static assets (`public/` + generated):**
- Purpose: Serve embeddable badges, registry, favicon, robots/llms.txt.
- Location: `public/badge/[author]/[skill].svg`, `public/badge/[author]/[skill]-history.svg`, `public/skills-registry.json`, `public/favicon.*`, `public/robots.txt`, `public/llms.txt`.
- Generated: The badge tree and registry are regenerated each build by prebuild scripts and git-ignored (`.gitignore:41-43`).

## Data Flow

**Daily cron pipeline (the canonical run order):**

Order is defined in `.github/workflows/daily-scrape.yml` and differs from `npm run pipeline`. The CI flow is authoritative.

1. **Restore ETag cache** (`daily-scrape.yml:41-47`) — `actions/cache/restore@v4` rehydrates `data/etag-cache.json` from a previous run. Without this, a cold run is ~7h (CLAUDE.md); with it, ~2-3 min.
2. **`npm run scrape`** (`daily-scrape.yml:50-54`; `scripts/scrape.js`) — GitHub code search + topics + seed list → fetch SKILL.md content → `parse-skill.js` → `score.js` → `categorize.js` → writes:
   - `data/skills-raw.json` (~295 MB, ~33k rows, gitignored; grew when body_markdown truncation moved from filter to scraper at 5000 chars)
   - `data/etag-cache.json` (gitignored, bounded ~500 MB)
   - `data/history/YYYY-MM-DD.json` (written inside `scrape.js:243`, committed)
   - `data/pipeline-stats.json` (committed)
3. **Save ETag cache** (`daily-scrape.yml:62-67`) — runs with `if: always()` so even a timed-out scrape persists partial cache.
4. **`npm run filter`** (`daily-scrape.yml:70-72`; `scripts/filter.js`) — dedup, slop removal, per-repo cap, tier recalibration. Reads `skills-raw.json`, writes `data/skills.json` (committed).
5. **`npm run embed`** (`daily-scrape.yml:78-81`; `scripts/embed-skills.js`) — Reads `data/skills.json`, uses a content_sha delta check against the prior `data/skill-vectors.ndjson`, only re-embeds changed skills. Writes `data/skill-vectors.ndjson` (committed — acts as the embedding cache).
6. **`npm run upload-vectors`** (`daily-scrape.yml:83-87`; `scripts/upload-vectors.js`) — Upserts the ndjson into Cloudflare Vectorize via REST API.
7. **Regression guard** (`daily-scrape.yml:90-97`) — Fails the run if skill count < 100.
8. **`npm run build`** (`daily-scrape.yml:100-103`) — triggers `prebuild` (see below), then `astro build`.
9. **Deploy** (`daily-scrape.yml:106-111`) — `cloudflare/wrangler-action@v3` with `command: deploy`.
10. **Health check** (`daily-scrape.yml:114-121`) — HEAD-style curl against `https://claudeatlas.com`.
11. **Commit updated data** (`daily-scrape.yml:125-132`) — Commits `data/skills.json`, `data/pipeline-stats.json`, and `data/history/` back to `main` as `ClaudeAtlas Bot`.

**Prebuild chain** (`package.json:17`):

```
generate-badges.js → generate-registry.js → compute-similar.js → generate-marketplace.js → mine-apis.js
```

Each reads `data/skills.json` (and `data/star-history.json` / `data/skill-vectors.ndjson` where relevant) and writes its output before `astro build` imports them.

**Which data file feeds which page:**

| Source file                 | Writer                                  | Consumers                                                                                         |
|-----------------------------|-----------------------------------------|---------------------------------------------------------------------------------------------------|
| `data/skills.json`          | `scripts/filter.js:237`                 | Every Astro page (via `src/lib/skills.js:9` import) and every prebuild script.                    |
| `data/pipeline-stats.json`  | `scripts/filter.js:251`, `scrape.js:696`| `src/lib/skills.js:10` → `getPipelineStats()` → homepage hero (`index.astro:9`).                  |
| `data/history/YYYY-MM-DD.json` | `scripts/scrape.js:243` (`writeHistorySnapshot`) | `scripts/generate-badges.js` for star-history SVGs (referenced by name in `generate-badges.js:17`). NOT read directly by any Astro page. |
| `data/star-history.json`    | `scripts/backfill-star-history.js:261`  | `scripts/generate-badges.js:33` for the `-history.svg` line charts.                               |
| `data/similar-skills.json`  | `scripts/compute-similar.js:127`        | `src/lib/skills.js:17` → `getSimilarSkills()` → `src/pages/skills/[...slug].astro:28`.            |
| `data/api-graph.json`       | `scripts/mine-apis.js:275`              | `src/lib/skills.js:28` → `getApiGraph`, `getAllServices`, `getServiceById`, `getSkillIntegrations` → `src/pages/apis/index.astro`, `src/pages/apis/[service].astro`, skill detail pages (integration chips). |
| `data/skill-vectors.ndjson` | `scripts/embed-skills.js:218`           | `scripts/compute-similar.js`, `scripts/compute-clusters.js`, `scripts/upload-vectors.js`. Not read by the site directly. |
| `data/skill-clusters.json`  | `scripts/compute-clusters.js:293`       | **No site consumer.** See Discrepancies.                                                          |
| `public/marketplace.json`   | `scripts/generate-marketplace.js:117`   | External: served statically as `.claude-plugin/marketplace.json` for agent federation.            |
| `public/skills-registry.json` | `scripts/generate-registry.js:103`    | External: machine-readable entry point for agents.                                                |
| `public/badge/[author]/[skill].svg` | `scripts/generate-badges.js:283` | External: embedded by creators in their READMEs.                                                  |
| `public/badge/[author]/[skill]-history.svg` | `scripts/generate-badges.js:302` | External: star-history line chart badges.                                                         |
| `data/plugins-raw.json`     | `scripts/scrape-plugins.js:446`         | **No site or prebuild consumer yet** — exploratory scraper for the Phase 3.0 spec (research only). |

**State Management:**
- **Build-time only.** Every page is a pure function of the JSON files imported at build time.
- Runtime state exists only in (a) Vectorize (queried from the Worker), (b) D1 (written by the Worker, never read by the site), and (c) KV (optional query-embedding cache).

## Key Abstractions

**Skill record:**
- Purpose: Canonical unit of content. One SKILL.md file in a GitHub repo.
- Examples: Every entry in `data/skills.json` (see `CLAUDE.md` `SkillRecord` interface for shape).
- Pattern: `{id, slug, name, description, repo_*, frontmatter, body_markdown, quality_score, quality_tier, category, tags, content_sha, source}`.

**Creator record:**
- Purpose: Virtual aggregation over all skills whose `repo_full_name` starts with the same owner.
- Examples: Derived at build time by `getCreators()` in `src/lib/skills.js:117`. Never persisted.
- Pattern: Star-count dedup by repo (`skills.js:137`), composite `total_quality_score` (`skills.js:183`), computed badges Prolific/Quality/Rising (`skills.js:199-204`).

**Service / API integration:**
- Purpose: Mined reference to an external API/SDK inside skill content.
- Examples: `data/api-graph.json` — `services.{id}` (service metadata) and `skill_integrations.{slug}` (list of service IDs per skill).
- Pattern: Produced by regex + allow-list matching in `scripts/mine-apis.js`; consumed by `src/pages/apis/*.astro` and the integration chip on skill detail pages.

**Quality signal:**
- Purpose: Seven-axis 0-100 scorer feeding `quality_score` and tier buckets.
- Examples: `scripts/score.js` implementation; tier thresholds in `scripts/filter.js`.
- Pattern: Weighted sum (stars 20 / recency 20 / frontmatter 20 / docs 15 / issue-health 10 / license 10 / description 5); cutoffs 90 Featured, 70 Solid, <70 Listed.

## Entry Points

**Static site entry:**
- Location: `src/pages/index.astro` (homepage), one Astro route per `src/pages/**/*.astro`.
- Triggers: `astro build` during CI; `astro dev` locally (`npm run dev`, port 4321).
- Responsibilities: Render all pre-renderable routes from `data/*.json`.

**Edge entry:**
- Location: `worker/index.js` `default.fetch` at line 322-345.
- Triggers: Any HTTP request to the deployed Worker (`claudeatlas.com/*`).
- Responsibilities: Route `/api/log-search` and `/api/v1/search`, fall through to `env.ASSETS.fetch` for everything else.

**Scraper entry:**
- Location: `scripts/scrape.js` (main `async` at bottom).
- Triggers: `npm run scrape`, invoked by the daily cron.
- Responsibilities: GitHub discovery + metadata + content fetch; writes `skills-raw.json`, `etag-cache.json`, `pipeline-stats.json`, `data/history/<today>.json`.

## Request Lifecycle — `/api/v1/search`

Implemented in `worker/index.js:188` (`semanticSearch`). Full flow:

1. **Method dispatch** (`worker/index.js:197-217`) — Accepts `GET ?q=...&k=&tier=&category=` or `POST {query, k, tier, category}`. Query is clamped to `MAX_QUERY_LEN = 200` (line 28).
2. **Query embedding** (`worker/index.js:132-186` `embedQuery`):
   - Cache key: `'qe:' + query.toLowerCase().trim()` (`worker/index.js:128-130`).
   - **KV hit path:** `env.QUERY_CACHE.get(cacheKey, { type: 'json' })` — if present and length matches `EMBEDDING_DIMENSIONS = 1536`, return immediately (saves the ~1.1s OpenAI round trip).
   - **Cache miss path:** POST to `https://api.openai.com/v1/embeddings` with `text-embedding-3-small`, 1536 dims. Result is fire-and-forget written to KV with `expirationTtl: 86400` (line 178).
3. **Vectorize query** (`worker/index.js:244-263`) — `env.VECTORIZE.query(queryVector, { topK, returnMetadata: 'all', filter })`. Optional metadata filter on `quality_tier` and `category` via `$eq`.
4. **Slug dedup** (`worker/index.js:269-277`) — Known: ~6 skill slugs collide today; keep the highest-scoring match per slug.
5. **Response shape** (`worker/index.js:278-315`) — `{query, count, timings_ms: {embed, vector, total}, embed_cached, results: [{slug, score, name, category, quality_tier, quality_score, repo_stars, repo_full_name, description, detail_url}]}`.
6. **D1 logging** (`worker/index.js:294-307`) — Fire-and-forget insert into `search_events` (schema in `worker/schema.sql`). Does NOT await; response returns first.

## Request Lifecycle — `/api/log-search`

Implemented in `worker/index.js:72` (`logSearch`). POST-only, JSON body `{query}`:
1. Read `cf-connecting-ip` (or `x-forwarded-for`).
2. Compute `ipHash = SHA-256(SALT_SECRET + YYYY-MM-DD + ip)` (`worker/index.js:91`) — daily salt rotation prevents cross-day tracking, preserves same-day dedup.
3. INSERT `{timestamp, query, ip_hash, country}` into D1 `search_events` table.

## Build-Time vs Runtime Split

| Concern                          | Build-time (static)                                      | Runtime (Worker)                                  |
|----------------------------------|----------------------------------------------------------|---------------------------------------------------|
| Homepage, category, skill detail | `astro build` → `dist/**/*.html`                         | —                                                 |
| Category/creator/API listings    | `getStaticPaths()` expands all dynamic routes            | —                                                 |
| SVG badges                       | `scripts/generate-badges.js` → `public/badge/**/*.svg`   | —                                                 |
| Registry + marketplace JSON      | Prebuild scripts → `public/*.json`                       | —                                                 |
| Keyword search on homepage       | Client-side JS filter over the fully rendered grid       | —                                                 |
| Semantic search                  | —                                                        | `/api/v1/search` via Vectorize                    |
| Query telemetry                  | —                                                        | `/api/log-search` → D1                            |

## Cache Layers

| Layer                 | Location                              | Purpose                                                                   | Status                                  |
|-----------------------|---------------------------------------|---------------------------------------------------------------------------|-----------------------------------------|
| GitHub ETag cache     | `data/etag-cache.json` (gitignored)   | Skip unchanged-repo requests on subsequent scrapes. ~500 MB when full.    | Active. Persisted via `actions/cache`.  |
| Embedding delta cache | `data/skill-vectors.ndjson` (committed) | `embed-skills.js` re-embeds only skills whose `content_sha` changed.    | Active.                                 |
| Workers KV            | `claudeatlas-query-cache` namespace   | Cache OpenAI query embeddings for 24h to cut `/api/v1/search` latency.    | **Code-complete, namespace not yet bound** (`wrangler.toml:44-46` commented out, pending morning activation per `PHASE-1.5-MORNING.md`). |
| D1 search log         | `claudeatlas-search-log` DB           | Fire-and-forget telemetry, not a cache.                                   | Active.                                 |
| Vectorize             | `claudeatlas-skills` index            | 1536-dim cosine index of skill embeddings.                                | Active.                                 |
| Browser / CDN         | Cloudflare edge + browser default     | Standard static-asset caching via Workers Static Assets.                  | Default Cloudflare behavior; no custom headers beyond `cache-control: no-store` on API responses (`worker/index.js:51`). |

## Moat Components

| Moat                  | Produced by                          | Stored in                           | Compounds because                                                     |
|-----------------------|--------------------------------------|-------------------------------------|-----------------------------------------------------------------------|
| Daily star snapshots  | `scripts/scrape.js:243` (`writeHistorySnapshot`) | `data/history/YYYY-MM-DD.json` (committed) | Every successful daily run adds one irreplaceable data point.         |
| Star-history backfill | `scripts/backfill-star-history.js`   | `data/star-history.json`            | One-shot historical backfill (pre-`history/` start date).             |
| Skill birth dates     | `scripts/backfill-skill-birth-dates.js` | Merged into `data/skills.json` (`skill_first_commit_at`) | One-shot backfill via git log on skill paths.                         |
| Embedding index       | `embed-skills.js` + `upload-vectors.js` | `data/skill-vectors.ndjson` + Vectorize | Delta-only re-embedding keeps the API cost bounded by real churn.     |
| API capability graph  | `scripts/mine-apis.js`               | `data/api-graph.json`               | Allows the `/apis/*` surface and per-skill integration chips that no raw GitHub listing offers. |

## Error Handling

**Strategy:** Fail gracefully at build time; degrade gracefully at runtime.

**Patterns:**
- **Soft JSON loads.** `src/lib/skills.js:19-36` uses `existsSync` + `try/catch` for `similar-skills.json` and `api-graph.json` so a first-ever build succeeds without them.
- **Fire-and-forget writes.** D1 logging and KV writes in the Worker never await — a failure logs to `console.error` but cannot block the response (`worker/index.js:179`, `294-307`).
- **Checkpoint-and-resume.** Every long-running script (`scrape.js:626`, `backfill-star-history.js:183`, `scrape-plugins.js:307`, `backfill-skill-birth-dates.js:201`, `embed-skills.js:254`) writes a `.partial` checkpoint every N records.
- **Regression guard.** `daily-scrape.yml:90-97` fails CI if the catalog falls below 100 skills.
- **Cache persistence on cancel.** `daily-scrape.yml:62-67` saves the ETag cache with `if: always()` so timeouts don't trap subsequent runs in cold-scrape loops.

## Cross-Cutting Concerns

**Logging:** `console.log`/`console.error` in scripts and the Worker. No structured logger. Pipeline scripts tee their own `.log` files (e.g. `scripts/embed-skills.log`, `scripts/backfill-star-history.log`) — gitignored (`.gitignore:36-38, 46, 50`).

**Validation:** None centralized. Parse-time validation in `scripts/parse-skill.js` (frontmatter presence); request-time validation in the Worker (query length, JSON parse).

**Authentication:** None for site or `/api/v1/search`. `SCRAPE_PAT` (GitHub PAT) is a CI secret. `SALT_SECRET` and `OPENAI_API_KEY` are Worker secrets. `CF_API_TOKEN` and `CF_ACCOUNT_ID` for deploy.

**Privacy:** IPs are daily-salted SHA-256 hashes (`worker/index.js:91`). Only hash, timestamp, query, and country are stored (`worker/schema.sql:10-16`).

## Discrepancies with Roadmap

Checked `.planning/ROADMAP.md` against actual implementation. Gaps flagged here should be addressed before any phase claims "done" downstream.

1. **Phase 2.5 clusters — no site consumer.** `scripts/compute-clusters.js` writes `data/skill-clusters.json:293`, but no file in `src/` references `skill-clusters` or `skillClusters`. The roadmap entry (`ROADMAP.md:37`) marks this `[x]` with a note "visual page deferred" — the data exists, but the page does not, and the script is **not wired into `package.json:17` prebuild nor `daily-scrape.yml`**. Clusters will go stale the moment `skills.json` changes. **Fix:** add `node scripts/compute-clusters.js` to prebuild, or move the script to the backfill tier if intentional.
2. **Daily history snapshots — only one file exists.** CLAUDE.md claims snapshots started 2026-04-11 and today is 2026-04-14, so `data/history/` should contain 4 files. It contains 1 (`2026-04-11.json`). Either the daily cron has not produced a green run since, or the commit-back step (`daily-scrape.yml:130`) has been failing silently on `data/history/`. **Fix:** check GitHub Actions run history; verify `git add data/history/` globs correctly (it uses a trailing slash, which `git add` tolerates but is worth re-checking).
3. **Phase 2.2 KV query cache — code shipped, binding not activated.** The Worker code path for `env.QUERY_CACHE` is complete (`worker/index.js:139-149, 174-183`), but `wrangler.toml:44-46` still has the binding commented out. Searches currently pay the full ~1.1s OpenAI round trip every time. Roadmap marks this `[x]` (`ROADMAP.md:34`).
4. **`scripts/scrape-plugins.js` — research only, not in any pipeline.** Produces `data/plugins-raw.json` but no downstream consumer exists. This is consistent with the Phase 3.0 spec (`docs/PHASE-3.0-SPEC.md`) but if something changes, remember it has to be wired manually.
5. **`compute-similar.js` runs in prebuild, `compute-clusters.js` does not.** Both read `data/skill-vectors.ndjson`. Adding clusters to prebuild is a one-line change in `package.json:17`.
6. **Backfill scripts are not in daily CI.** `backfill-star-history.js` and `backfill-skill-birth-dates.js` are one-shot scripts (their own header comments confirm this). They were run manually during Phase 2 Data Moats. Any new Featured skill added after that run will not have `skill_first_commit_at` until the backfill is re-run. No automation around this exists.

---

*Architecture analysis: 2026-04-14*
