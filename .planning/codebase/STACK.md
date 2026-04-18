# Technology Stack

**Analysis Date:** 2026-04-14

## Languages

**Primary:**
- JavaScript (ES2022, ESM) — entire codebase. `package.json:4` sets `"type": "module"`. Used in `scripts/*.js`, `worker/index.js`, `src/lib/*.js`.
- Astro components — `.astro` files in `src/pages/` and `src/components/` (templating + island scripts).

**Secondary:**
- SQL — `worker/schema.sql` (Cloudflare D1 schema for `search_events`).
- HTML/CSS — emitted by Astro build; Tailwind utility classes in components.

**Inferred:** No TypeScript source files exist, but TS tooling is wired. `tsconfig.json` extends `astro/tsconfigs/strict` with `allowJs: true` + `resolveJsonModule: true`. JSDoc `@type` annotations used in `src/lib/skills.js:38` and `src/lib/analytics.js:32`. Treat the codebase as "TS-checked JavaScript", not TypeScript.

## Runtime

**Environment:**
- Node.js 20 — pinned in CI (`.github/workflows/daily-scrape.yml:25` — `node-version: 20`). No `.nvmrc` committed.
- Cloudflare Workers runtime — `worker/index.js` runs on V8 isolates. `wrangler.toml:2` sets `compatibility_date = "2026-04-10"`.
- Browsers — static output, no browser target config; Astro 5 defaults (modern evergreen).

**Package Manager:**
- npm — `package-lock.json` committed (lockfile v3, `package-lock.json:3`). CI uses `npm ci` (`.github/workflows/daily-scrape.yml:28`) with `cache: npm` on `actions/setup-node`.

## Frameworks

**Core (site):**
- `astro` ^5.7.10 — static site generator. `astro.config.mjs:8` sets `output: 'static'`, `build.format: 'directory'`, `site: 'https://claudeatlas.com'`.
- `@astrojs/tailwind` ^6.0.2 — Tailwind integration (`astro.config.mjs:10`).
- `@astrojs/sitemap` ^3.3.1 — sitemap.xml generation (`astro.config.mjs:11`).
- `tailwindcss` ^3.4.17 — styling; config in `tailwind.config.mjs` with custom `atlas` palette + `featured`/`solid`/`listed` tier colors.

**Core (Worker):**
- No framework — `worker/index.js` is a plain `export default { fetch }` handler using Web Fetch API + Cloudflare bindings (`env.ASSETS`, `env.DB`, `env.VECTORIZE`, `env.QUERY_CACHE`).

**Data pipeline libraries:**
- `gray-matter` ^4.0.3 — YAML frontmatter parsing for `SKILL.md` files (used in `scripts/parse-skill.js`).
- `p-queue` ^9.1.2 — concurrency control for scraper/embedder fan-out.

**Testing:**
- None. No test framework dependency, no `*.test.*` or `*.spec.*` files, no `test` npm script.

**Build/Dev:**
- Astro CLI — `astro dev`, `astro build`, `astro preview` (`package.json:18-20`).
- `wrangler` (via `cloudflare/wrangler-action@v3` in CI; not in local `devDependencies`) — deploys. Not runnable locally on Windows ARM64 per `wrangler.toml:22` comment.

## Key Dependencies

**Critical (runtime at build/pipeline time):**
- `astro` — site generator; cannot swap per project constraints in `CLAUDE.md`.
- `gray-matter` — parses every SKILL.md harvested.
- `p-queue` — prevents GitHub/OpenAI rate-limit blowouts.

**Infrastructure (not in `package.json`, bound at runtime):**
- Cloudflare D1 `claudeatlas-search-log` (id `d4e341fa-17d6-4069-8a00-3b6a8d698ab9`, `wrangler.toml:16-19`).
- Cloudflare Vectorize index `claudeatlas-skills`, 1536-dim cosine (`wrangler.toml:27-29`).
- Cloudflare KV namespace `claudeatlas-query-cache` — **not yet active** (`wrangler.toml:44-46` is commented out pending namespace provisioning).

## Configuration

**Build-time env (baked into client bundle):**
- `PUBLIC_POSTHOG_KEY` — read at `src/lib/analytics.js:25` via `import.meta.env`. Optional; loader no-ops when unset.

**Pipeline env (scripts/):**
- `GITHUB_TOKEN` — hard-fail at `scripts/scrape.js:29-35` if missing.
- `OPENAI_API_KEY` — soft-fail in `scripts/embed-skills.js:57-60` (skips only if no deltas).
- `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_VECTORIZE_INDEX` — `scripts/upload-vectors.js:33-35`. Soft-fail with `exit 0` if creds missing (`scripts/upload-vectors.js:42-48`).

**Worker env (runtime secrets via `wrangler secret put`):**
- `OPENAI_API_KEY` — for query-time embedding (`worker/index.js:133`).
- `SALT_SECRET` — SHA-256 salt for IP hashing (`worker/index.js:89`).

**Build config files:**
- `astro.config.mjs` — 17 lines, integrations + static output.
- `tailwind.config.mjs` — 30 lines, custom palette.
- `tsconfig.json` — 9 lines, Astro strict preset.
- `wrangler.toml` — 47 lines, bindings + commented KV.

**`.env` handling:** `.env` files are gitignored per `docs/SECRETS.md:111`. No `.env.example` spotted at repo root during scan. Canonical reference is `docs/SECRETS.md`.

## Platform Requirements

**Development:**
- Node 20+, npm, a GitHub fine-grained PAT, and ~500 MB disk for the ETag cache (`CLAUDE.md` "Known issues" #1).
- Wrangler CLI does not run on Windows ARM64 (`wrangler.toml:22` comment). Local Windows devs use the Cloudflare REST API directly for Vectorize provisioning.

**Production:**
- Cloudflare Workers Static Assets — `wrangler.toml:9-12` maps `./dist` with `not_found_handling = "404-page"` and binding `ASSETS`.
- Custom domain `claudeatlas.com` fronting `claudeatlas.danthedub.workers.dev` (per `CLAUDE.md`).
- Cost target: free tier for everything except the domain (~$12/yr).

## Deploy Infrastructure

**CI:** GitHub Actions — `.github/workflows/daily-scrape.yml`
- Triggers: daily cron `30 6 * * *` (6:30 AM UTC), `workflow_dispatch`, and `push` to `main`.
- Timeout: 420 minutes (cold scrape ~7h; warm run 2–3 min; push-triggered ~90s skipping scrape).
- Steps: checkout → setup-node@v4 (Node 20, npm cache) → `npm ci` → restore ETag cache → `npm run scrape` → save ETag cache (`if: always()`) → `npm run filter` → `npm run embed` (OpenAI) → `npm run upload-vectors` (Vectorize REST) → regression guard (min 100 skills) → `npm run build` → `cloudflare/wrangler-action@v3 deploy` → health check on `https://claudeatlas.com` → commit `data/skills.json` + `data/pipeline-stats.json` + `data/history/`.

**Deploy command:** `npx wrangler deploy` (inside `wrangler-action@v3`, `.github/workflows/daily-scrape.yml:107-111`).

## Local Dev Commands

From `package.json:6-22`:

```bash
npm run scrape            # node scripts/scrape.js (needs GITHUB_TOKEN)
npm run filter            # node scripts/filter.js (fast, <1s)
npm run pipeline          # scrape + filter
npm run badges            # node scripts/generate-badges.js
npm run registry          # node scripts/generate-registry.js
npm run embed             # node scripts/embed-skills.js (needs OPENAI_API_KEY)
npm run upload-vectors    # node scripts/upload-vectors.js (needs CF_*)
npm run compute-similar   # node scripts/compute-similar.js
npm run marketplace       # node scripts/generate-marketplace.js
npm run mine-apis         # node scripts/mine-apis.js
npm run prebuild          # badges + registry + compute-similar + marketplace + mine-apis
npm run dev               # astro dev (http://localhost:4321)
npm run build             # astro build (outputs dist/)
npm run preview           # astro preview (http://localhost:4322)
```

Note: `prebuild` is an explicit script but not wired as an npm lifecycle pre-hook of `build`. It must be invoked deliberately (or is run implicitly via CI step ordering — verify before relying on it).

## Data Artifact Shapes

- `data/skills.json` — committed, ~4 MB, 1,078 skills. Imported directly in `src/lib/skills.js:9`.
- `data/skills-raw.json` — gitignored, ~8 MB, 33k skills. Scraper output (`scripts/scrape.js:25`).
- `data/etag-cache.json` — gitignored, ~500 MB. Restored/saved via `actions/cache@v4`.
- `data/history/YYYY-MM-DD.json` — committed, ~225 KB/day, daily stars/forks snapshot.
- `data/skill-vectors.ndjson` — NDJSON embeddings (`scripts/embed-skills.js:55`), uploaded via `scripts/upload-vectors.js`.
- `data/similar-skills.json`, `data/api-graph.json` — lazily loaded with `existsSync` guard in `src/lib/skills.js:19-36` (gracefully degrades on first build).

---

*Stack analysis: 2026-04-14*
