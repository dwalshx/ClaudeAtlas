# Badge → Worker Route Migration (deploy-reliability fix)

**Status:** PLANNED 2026-06-17, ready to execute. Investigated by an architect agent against the real code.
**Why:** Cloudflare deploy 504s on the ~105,854-file asset upload (`assets-upload-session -> 504`). `/badge/` is ~55% of files (18,436 in a local build; ~50k+ prod — 2 SVGs/skill for featured/solid/top tiers). Moving badges to an on-demand Worker route halves the deploy file count → reliable deploys. **This blocks ALL deploys, not just one feature** (the nav change is currently stuck behind it).

## Approach (chosen)

Serve `/badge/{slug}.svg` (tier) and `/badge/{slug}-history.svg` (star chart) from a **Worker route**, generated per-request. **Bundle** a compact star-history JSON into the Worker (the only data it lacks); tier data is already in `SKILLS_KV`. Stop emitting the ~50k static badge files.

### Key findings
- `scripts/generate-badges.js` (prebuild, `package.json:23`) emits 2 SVGs/skill for tiers `{featured, top, solid}` (`BADGE_TIERS`, line 279) → 9,218 skills × 2 = 18,436 files locally. SVG builders (`buildTierBadgeSvg` 82-127, `buildStarHistoryChartSvg` 131-207) are **pure functions, zero Node deps → port verbatim for byte-identical output**.
- Tier badge needs only `quality_tier`/`name`/`slug` — **already in SKILLS_KV** (`publish-kv.js:140` streams the full catalog, no tier filter).
- Star-history needs a per-repo series. The 9,218 badge skills span only **158 unique repos** → a downsampled (≤60-pt) `repo → [[ts,count]]` map = **177.6 KB**. Bundle it into the Worker exactly like `slug-redirects.json` (`worker/index.js:37`). Zero KV reads, $0, well under the 10 MB Worker / $102-yr limits.
- Routing: `wrangler.toml:31` `run_worker_first` must add `/badge/*` so the Worker owns it (assets binding would 404 post-migration since static files are gone).
- Multi-segment slugs exist (815, e.g. `microsoft/skills/azure-aigateway`) — treat everything after `/badge/` (minus `.svg`/`-history`) as the slug.

## Ordered task breakdown (execute via `/gsd:quick --full`)

1. **`scripts/generate-badge-data.js`** (new): load `skills.ndjson`, collect `repo_full_name` for featured/solid/top, merge `data/star-history.json` + `data/history/*.json` (reuse merge logic from `generate-badges.js:211-325`), downsample to ~60 pts, write compact `data/badge-star-history.json` (`repo → [[tsMs,count]]`). Add the sidecar `readFileSync`s to `scripts/check-banned-patterns.js` allowlist (like `pipeline-stats.json`/`kv-published.json`).
2. **`worker/badge.js`** (new): port `escapeXml`/`textWidth`/`validateSlug`/`TIER_COLORS`/`buildTierBadgeSvg`/`buildStarHistoryChartSvg`/`SITE_URL`/`REF_PARAM` **verbatim** from `generate-badges.js:38-207`; add `handleBadge(url, env, starHistory)`: parse slug (+`-history` suffix), tier → `SKILLS_KV.get(slug)` → `buildTierBadgeSvg` (default 'listed' on KV miss, never 404 a hotlink), history → bundled series → `buildStarHistoryChartSvg` (placeholder for unknown repo). Return SVG with `content-type: image/svg+xml; charset=utf-8`, `cache-control: public, max-age=86400, s-maxage=86400`, `access-control-allow-origin: *`, ETag.
3. **`worker/index.js`**: import the bundle (`import starHistoryData from '../data/badge-star-history.json'`) + `handleBadge`; add `if (url.pathname.startsWith('/badge/') && url.pathname.endsWith('.svg')) return handleBadge(...)` before the `env.ASSETS.fetch` fallthrough (~line 872).
4. **`wrangler.toml:31`**: `run_worker_first = ["/skills/*", "/api/*", "/badge/*"]`.
5. **`package.json:23` prebuild**: remove `node scripts/generate-badges.js`; add `node scripts/generate-badge-data.js`; keep a `badges:data` script.
6. **Local verify**: `npm run build`; confirm `dist/badge/` gone (~18k fewer files locally); `wrangler dev` + curl tier + history + a multi-segment slug + a no-history repo; diff SVG output against the old static files → expect zero diff.
7. **Delete `scripts/generate-badges.js`** after verification (history kept in git as the byte-identical reference).
8. **Deploy**: branch-push (build-only) to confirm bundle+Worker compile; then `main` deploy → the halved file count should clear the `assets-upload-session` 504. Live smoke: `curl -sI https://claudeatlas.com/badge/<a>/<s>.svg` → 200 + svg content-type + cache-control; 2nd request `cf-cache-status: HIT`.
9. **daily-scrape.yml**: ensure `data/badge-star-history.json` is committed back (mirror `data/history/<today>.json`) so the bundle stays fresh; the existing wrangler deploy step ships the new bundle.

## Risks / compat
- Hotlink URLs unchanged (`?ref=badge` linkback ports verbatim).
- Byte-identical output (pure builders + pre-downsample reproduces build-time sampling).
- CPU: pure string build + ≤1 KV.get; well under 50 ms.
- Cache: `max-age=86400` → ~1 gen/edge/day; daily redeploy busts the bundle.
- Mandatory: `/badge/*` in `run_worker_first` (else assets 404s).

## Critical files
- `scripts/generate-badges.js` (port pure SVG fns from, then delete)
- `worker/index.js` (add `/badge/*` route + bundle import)
- `wrangler.toml` (`run_worker_first`)
- `package.json` (prebuild swap)
- `scripts/lib/publish-kv.js` (confirms tier data in KV; no change)
