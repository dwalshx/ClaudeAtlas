# External Integrations

**Analysis Date:** 2026-04-14

## APIs & External Services

### GitHub REST API — discovery + metadata

**Purpose:** discover SKILL.md files, fetch repo metadata, read file contents, walk git trees.

**Endpoints used (all `https://api.github.com/*`):**
- `GET /search/code?q=...&per_page=100&page=N` — `scripts/scrape.js:268`. Size-range partitioned to exceed the 1000-result cap.
- `GET /search/repositories?q=topic:<topic>&per_page=100&sort=stars&order=desc` — `scripts/scrape.js:314`.
- `GET /repos/{repo}/git/trees/main?recursive=1` (fallback `master`) — `scripts/scrape.js:353,358`.
- `GET /repos/{repo}/git/trees/{branch}?recursive=1` — `scripts/scrape.js:389`.
- `GET /repos/{repo}` — `scripts/scrape.js:410`.
- `GET /repos/{repo}/contents/{path}` — `scripts/scrape.js:441`.

**Auth:** Bearer token via fine-grained PAT. Header set in `scripts/scrape.js:39-43`:
```
Authorization: Bearer ${TOKEN}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

**Env var:** `GITHUB_TOKEN` locally; `SCRAPE_PAT` in CI (mapped to `GITHUB_TOKEN` env var at `.github/workflows/daily-scrape.yml:54`).

**Rate limits (enforced client-side in `scripts/scrape.js:54-116`):**
- Code search: **10 req/min** (authed). Script caps at 9/min with a 60-second sleep window (`scrape.js:63-69`).
- General REST: **5,000 req/hr** (authed). Script caps at 4,800/hr (`scrape.js:77-83`).
- 403/429 handling: reads `x-ratelimit-reset` header, sleeps until reset + 1s buffer; falls back to 60s if header absent (`scrape.js:100-112`).

**ETag caching:** `data/etag-cache.json` (~500 MB, gitignored). Conditional requests via `If-None-Match`. First cold scrape ~7h; subsequent warm runs 2–3 min. Cache persisted across GitHub Actions runs via `actions/cache@v4` with `if: always()` save (`.github/workflows/daily-scrape.yml:42-67`).

**Resilience:** 3 network retries with 5s backoff (`scrape.js:90-97`). Checkpoint saves every 1,000 skills (`data/skills.json.partial`) per `CLAUDE.md` "Known issues" #2.

### OpenAI API — embeddings

**Purpose:** convert skill content and live search queries into 1536-dim vectors.

**Endpoint:** `POST https://api.openai.com/v1/embeddings` — called from two places:
- Batch/build time: `scripts/embed-skills.js` (batch size 100, ~30 req/min cap, `embed-skills.js:64-65`).
- Edge/runtime: `worker/index.js:151-162` for live query embedding.

**Model:** `text-embedding-3-small` at **1536 dimensions** (`worker/index.js:118-119`, `scripts/embed-skills.js:62-63`).

**Auth:** `Authorization: Bearer ${OPENAI_API_KEY}`.

**Env var:** `OPENAI_API_KEY`
- CI: `.github/workflows/daily-scrape.yml:81` (for `npm run embed`).
- Worker: set via `wrangler secret put OPENAI_API_KEY` (`worker/index.js:21`).
- Pipeline script soft-fails if unset but no deltas to embed (`embed-skills.js:57-60`).

**Rate limits (documented in `scripts/embed-skills.js:42-45`):**
- OpenAI tier-1 default: **3,000 req/min**, **1,000,000 tokens/min**.
- Script self-throttles to ~30 batches/min × 100 inputs/batch via `DELAY_BETWEEN_BATCHES_MS = 2000`.

**Cost profile (per `embed-skills.js:38-40`):**
- Cold embed of 1,078 skills × ~400 tokens ≈ 430k tokens × $0.02/M ≈ **$0.009** per full run.
- Delta runs (content-SHA based) cost proportionally less.

**Resilience:** 4 retries (`MAX_RETRIES = 4`, `embed-skills.js:66`). Resumable NDJSON at `data/skill-vectors.ndjson` keyed by `content_sha`; only re-embeds changed/new skills.

### Cloudflare Vectorize — semantic search vector DB

**Purpose:** store all skill embeddings and serve top-K similarity queries at the edge.

**Index:** `claudeatlas-skills`, **1536 dimensions**, **cosine** metric (`wrangler.toml:28-29`, `CLAUDE.md` + `wrangler.toml:24-25` comments).

**Access patterns:**
- **Upload (CI):** REST `POST /accounts/{account_id}/vectorize/v2/indexes/{index_name}/upsert` with `Content-Type: application/x-ndjson`, batch size 500, 4 retries with exponential backoff — `scripts/upload-vectors.js:61-80`.
- **Query (Worker):** `env.VECTORIZE.query(queryVector, { topK, returnMetadata: 'all', filter })` — `worker/index.js:247-259`. Supports `$eq` filters on `quality_tier` and `category`.

**Env vars (upload):** `CF_ACCOUNT_ID`, `CF_API_TOKEN` (requires `Vectorize:Edit`), optional `CF_VECTORIZE_INDEX` override — `scripts/upload-vectors.js:33-35`.

**Binding (Worker):** `VECTORIZE` declared in `wrangler.toml:27-29`.

**Provisioning note:** index was created via REST API (not `wrangler`) because Windows ARM64 cannot run wrangler — `wrangler.toml:22`.

**Idempotency:** upsert replaces by ID; IDs derived from `skill.id` (not slug) because 6 catalog entries share slugs — see `scripts/embed-skills.js:27-31`.

### Cloudflare D1 — search query log

**Purpose:** privacy-preserving log of search queries for analytics.

**Database:** `claudeatlas-search-log`, id `d4e341fa-17d6-4069-8a00-3b6a8d698ab9` (`wrangler.toml:16-19`).

**Binding:** `DB` — Worker prepared-statement API: `env.DB.prepare(...).bind(...).run()` (`worker/index.js:99-103`, `299-303`).

**Schema (`worker/schema.sql`):**
```sql
CREATE TABLE search_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  query TEXT NOT NULL,
  ip_hash TEXT,
  country TEXT
);
CREATE INDEX idx_search_events_timestamp ON search_events(timestamp);
CREATE INDEX idx_search_events_query ON search_events(query);
```

**Privacy design:**
- `ip_hash = SHA-256(SALT_SECRET + 'YYYY-MM-DD' + ip)` — daily salt rotation prevents cross-day tracking (`worker/index.js:89-91`, `worker/schema.sql:6-8`).
- `country` from `request.cf.country` (Cloudflare-injected, no geoip lookup).
- Query capped at `MAX_QUERY_LEN = 200` (`worker/index.js:28`).

**Write paths:**
- `POST /api/log-search` — explicit debounced logger (`worker/index.js:72-110`).
- `POST|GET /api/v1/search` — fire-and-forget log after semantic search (`worker/index.js:294-307`).

### Cloudflare KV — query embedding cache (**not yet active**)

**Purpose:** cache OpenAI query embeddings for 24h to skip ~1.1s OpenAI round-trip on repeat queries.

**Status:** provisioned in code, **not yet bound**. `wrangler.toml:44-46` is commented out pending namespace creation in the Cloudflare dashboard.

**Planned binding:** `QUERY_CACHE`, namespace `claudeatlas-query-cache`.

**Code readiness:** `worker/index.js:128-149, 173-183` already reads/writes with graceful fallback — absence of `env.QUERY_CACHE` simply skips the cache path.

**Cache key:** `'qe:' + query.toLowerCase().trim()` (`worker/index.js:128-130`).
**TTL:** `QUERY_CACHE_TTL_SECONDS = 86400` (24h, `worker/index.js:126`).
**Free tier:** 100k reads/day, 1k writes/day (`wrangler.toml:34`).

### PostHog — product analytics (EU cloud)

**Purpose:** event-based product analytics. Autocapture disabled.

**Host:** `https://eu.i.posthog.com` — hardcoded for GDPR reasons, **do not** use us.posthog.com (`src/lib/analytics.js:24`, `docs/SECRETS.md:67`).

**Config (`src/lib/analytics.js:54-61`):**
```js
posthog.init(KEY, {
  api_host: 'https://eu.i.posthog.com',
  autocapture: false,
  capture_pageview: false,
  capture_pageleave: false,
  disable_session_recording: true,
  persistence: 'localStorage+cookie'
});
```

**Tracked events (`src/lib/analytics.js:32-39`):** `copy_install_command`, `click_github_link`, `search_query`, `category_click`, `view_skill_detail`, `badge_click`.

**Env var:** `PUBLIC_POSTHOG_KEY` — baked into client bundle at build time via `import.meta.env.PUBLIC_POSTHOG_KEY` (`src/lib/analytics.js:25`). Technically public (visible in browser) but still managed as a secret to avoid hardcoding.

**Fail-open:** when `PUBLIC_POSTHOG_KEY` is unset, `buildPosthogSnippet()` returns `''` and no loader is injected. Site builds and works normally (`src/lib/analytics.js:50`, `docs/SECRETS.md:65`).

### Cloudflare Web Analytics

**Purpose:** basic site-level traffic analytics.

**Mode:** **Automatic Setup** — Cloudflare injects the beacon server-side for CF-managed domains. No client-side token, no env var, no code paths in repo (`docs/SECRETS.md:69-73`).

**Legacy var `PUBLIC_CF_ANALYTICS_TOKEN`** is **NOT USED** and explicitly deprecated in `docs/SECRETS.md:69-73`.

## Data Storage

**Databases:**
- Cloudflare D1 — search events only (see above).
- No other DBs. Primary catalog data lives in committed JSON files (`data/skills.json`) consumed directly by Astro at build time.

**Vector DB:**
- Cloudflare Vectorize — see above.

**File Storage:**
- Local filesystem only for pipeline artifacts (`data/*.json`, `data/skill-vectors.ndjson`).
- Cloudflare Workers Static Assets serves the built `dist/` bundle (`wrangler.toml:9-12`).

**Caching:**
- GitHub ETag cache in `data/etag-cache.json` (pipeline).
- Cloudflare KV `QUERY_CACHE` — **designed, not active**.

## Authentication & Identity

**No end-user authentication.** Public static site. Only service-to-service tokens exist.

**Privacy layer:** IP hashing with daily-rotating `SALT_SECRET` (Worker secret) prevents user re-identification even by the site operator — `worker/index.js:89-91`, `docs/SECRETS.md:75-80`.

## Monitoring & Observability

**Error Tracking:** None. `console.error` in the Worker + Wrangler logs only (`worker/index.js:105, 147, 239, 261, 305`).

**Logs:**
- Pipeline: stdout → `data/scrape-log.txt` (gitignored) + ad-hoc `scripts/*-log`.
- Worker: Cloudflare dashboard log stream (no log drain configured in `wrangler.toml`).

**Health check:** CI curls `https://claudeatlas.com` after deploy, warns on non-200 (`.github/workflows/daily-scrape.yml:113-121`).

**Regression guard:** CI fails if `data/skills.json` drops below 100 entries (`.github/workflows/daily-scrape.yml:90-97`).

## CI/CD & Deployment

**Hosting:** Cloudflare Workers Static Assets — binding `ASSETS` (`wrangler.toml:9-12`).

**Custom domain:** `claudeatlas.com` → `claudeatlas.danthedub.workers.dev` (per `CLAUDE.md`).

**CI Pipeline:** `.github/workflows/daily-scrape.yml`
- Triggers: `schedule: 30 6 * * *`, `workflow_dispatch`, `push: main`.
- Deploy action: `cloudflare/wrangler-action@v3` with `command: deploy` (line 106-111).
- Post-deploy: health check + commit updated data back to `main`.

## Environment Configuration

**Required env vars (see `docs/SECRETS.md` for the canonical matrix):**

| Variable | Scope | Local `.env` | GH Actions secret | Worker secret |
|---|---|:-:|:-:|:-:|
| `GITHUB_TOKEN` | local scrape/backfill | ✅ | — | — |
| `SCRAPE_PAT` | CI scraper (aliased to `GITHUB_TOKEN`) | — | ✅ | — |
| `OPENAI_API_KEY` | embed script + Worker query-time | ✅ | ✅ | ✅ |
| `CF_API_TOKEN` | wrangler deploy + Vectorize upsert | — | ✅ | — |
| `CF_ACCOUNT_ID` | wrangler deploy + Vectorize upsert | — | ✅ | — |
| `PUBLIC_POSTHOG_KEY` | client bundle (build-time) | ✅ | ✅ | — |
| `SALT_SECRET` | Worker IP hashing | — | — | ✅ |
| `CF_VECTORIZE_INDEX` | optional override | optional | — | — |

**`PUBLIC_CF_ANALYTICS_TOKEN`:** NOT USED — CF Web Analytics uses Automatic Setup (`docs/SECRETS.md:69-73`).

**Secrets locations:**
- Local: repo-root `.env` file, gitignored (`docs/SECRETS.md:111`).
- CI: `https://github.com/dwalshx/ClaudeAtlas/settings/secrets/actions`.
- Worker: `wrangler secret put <NAME>`.

**Never in repo:** `.env`, rotated-out tokens, real values in `SECRETS.md` (`docs/SECRETS.md:109-113`).

## Webhooks & Callbacks

**Incoming:** None. No webhook endpoints; Worker only exposes `/api/log-search` and `/api/v1/search`.

**Outgoing:** None (no webhook dispatch from pipeline or Worker).

## Internal API Catalog (Worker routes)

Exposed by `worker/index.js:322-346`:

| Route | Methods | Backends | Notes |
|---|---|---|---|
| `/api/log-search` | `POST` (+ OPTIONS) | D1 `DB` | Query required, max 200 chars; returns `{queued:true}`. 202 fallback if `DB` unbound. |
| `/api/v1/search` | `GET`, `POST` (+ OPTIONS) | OpenAI + Vectorize + optional KV + fire-and-forget D1 | Params: `q`/`query`, `k` (max 50, default 20), `tier`, `category`. Returns `{query, count, timings_ms, embed_cached, results[]}`. |
| `*` | any | `env.ASSETS.fetch` | Static fallthrough → `dist/`. |

CORS: `access-control-allow-origin: *` on all `/api/*` responses; preflight handled at `worker/index.js:327-329`.

---

*Integration audit: 2026-04-14*
