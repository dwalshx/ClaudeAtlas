---
phase: quick-260621-cvm
plan: 01
subsystem: deploy / worker
tags: [deploy-reliability, worker, badges, svg, cloudflare]
status: AWAITING HUMAN CHECKPOINT (Task 3 wrangler-dev smoke)
requirements: [DEPLOY-RELIABILITY]
dependency_graph:
  requires:
    - data/skills.ndjson (catalog, streaming-read)
    - data/star-history.json (backfill sidecar)
    - data/history/*.json (daily snapshots)
    - env.SKILLS_KV (per-slug tier records, already published by publish-kv.js)
  provides:
    - "/badge/{slug}.svg per-request tier pill (Worker)"
    - "/badge/{slug}-history.svg per-request star chart (Worker)"
    - data/badge-star-history.json (bundled star-history map)
  affects:
    - daily-scrape.yml deploy file count (halved → unblocks assets-upload 504)
tech-stack:
  added: []
  patterns:
    - "Native JSON bundle import into the Worker (mirrors slug-redirects.json)"
    - "Verbatim port of pure SVG builders for byte-identical output"
    - "Pre-downsample at build time so the Worker's re-downsample is idempotent"
key-files:
  created:
    - scripts/generate-badge-data.js
    - worker/badge.js
    - data/badge-star-history.json
  modified:
    - worker/index.js
    - wrangler.toml
    - package.json
    - scripts/check-banned-patterns.js
    - .github/workflows/daily-scrape.yml
    - .gitignore
  deleted:
    - scripts/generate-badges.js
decisions:
  - "badge-star-history.json is TRACKED (not gitignored) — it must ship with the Worker bundle on push-event deploys and is committed back daily; the plan frontmatter's 'gitignored on disk' wording was superseded by Task 3's commit-back requirement (resolved Rule 3)."
  - "handleBadge converts the bundle's [tsMs,count] back to {t: ISO, c} — the verbatim builder calls Date.parse(e.t), which is NaN on a numeric ms value (Rule 1 bug, caught by the diff harness)."
metrics:
  duration_min: 40
  completed: 2026-06-21
  tasks: 3
  commits: 3
  files_changed: 9
---

# Phase quick-260621-cvm: Badge → Worker Route Migration Summary

Moved per-skill badge SVGs off static-asset generation onto an on-demand
Cloudflare Worker route, deleting the ~18,436 local (~50k+ prod) static badge
files that pushed the deploy asset-upload over Cloudflare's cap and 504'd every
deploy. `/badge/{slug}.svg` (tier pill) and `/badge/{slug}-history.svg` (star
chart) are now generated per-request: tier from `SKILLS_KV`, star-history from a
177-460 KB JSON map bundled into the Worker like `slug-redirects.json`. The SVG
builders were ported verbatim and proven byte-identical to the old static output
across all 9,218 tier + 9,218 history badges (zero diff).

## What shipped

| Task | Name | Commit | Key files |
| ---- | ---- | ------ | --------- |
| 1 | Bundle generator + allowlist | `060ba32` | scripts/generate-badge-data.js, scripts/check-banned-patterns.js, data/badge-star-history.json |
| 2 | Worker badge route + wiring | `15d21d0` | worker/badge.js, worker/index.js, wrangler.toml, package.json |
| 3 | Verify + delete generator + commit-back | `0d5670c` | scripts/generate-badges.js (deleted), worker/badge.js (bug fix), .github/workflows/daily-scrape.yml, .gitignore |

## How it works

1. **Build time** (`prebuild`): `scripts/generate-badge-data.js` streaming-reads
   `data/skills.ndjson`, scopes the featured/top/solid repos (158 of them),
   merges `star-history.json` backfill + `data/history/*.json` snapshots using
   the **verbatim merge logic** from the old generator, pre-downsamples each
   series to ≤61 points with the **verbatim sample logic** from
   `buildStarHistoryChartSvg`, and writes `data/badge-star-history.json` as
   `{ "<repo>": [[tsMs, count], ...] }`.
2. **Bundle**: `worker/index.js` imports the map via native JSON import (esbuild
   inlines it) — same pattern as `slug-redirects.json`.
3. **Request time**: `worker/badge.js` `handleBadge(url, env, starHistory)`:
   - Parses the slug as everything after `/badge/` minus `.svg` (and minus a
     `-history` suffix). Does NOT split on `/` — multi-segment slugs work.
   - Tier path: `SKILLS_KV.get(slug)` → `buildTierBadgeSvg`; KV miss → synthetic
     `{ slug, name: slug, quality_tier: 'listed' }` (never 404s a hotlink).
   - History path: bundled `[tsMs,count]` → `{ t: ISO, c }` → `buildStarHistoryChartSvg`;
     unknown repo / synthetic record → `[]` → "Not enough history yet" placeholder.
   - Returns SVG with `content-type: image/svg+xml; charset=utf-8`,
     `cache-control: public, max-age=86400, s-maxage=86400`,
     `access-control-allow-origin: *`, and a weak ETag.

## Byte-identical verification (HARD requirement) — PASSED

A throwaway harness (`scripts/_tmp-badge-diff.mjs` + `worker/badge.test-shim.js`,
both deleted after the run) ran the OLD generator to produce all 18,436 static
SVGs under `public/badge/`, then compared every one against the ported Worker
builders fed the same skill record + the bundled (downsampled) series:

```
Bulk tier sweep:    9218 checked, 0 diffs
Bulk history sweep: 9218 checked, 0 diffs
RESULT: ZERO BYTE DIFF — byte-identical confirmed
```

The verbatim region of `worker/badge.js` was also diffed line-by-line against
`scripts/generate-badges.js:38-207` (modulo CRLF/LF) — all six functions
(SITE_URL/REF_PARAM/TIER_COLORS, escapeXml, textWidth, validateSlug,
buildTierBadgeSvg, buildStarHistoryChartSvg) MATCH exactly.

The 61-point re-downsample concern (the builder re-runs its ≤60 downsample on
the pre-downsampled bundle) was proven a **mathematical no-op**: for a 61-point
input, `floor(i * 61/60) === i` for i=0..59, then the last point is appended →
the identity sequence. So byte-identical output is robust, not a dataset fluke.

## Build verification — PASSED

- `npm run build` → exit 0. Prebuild ran `generate-badge-data.js` (not the
  deleted `generate-badges.js`).
- `dist/badge/` does **NOT** exist; no badge SVGs anywhere in `dist/`.
- `dist/` file count = **11,561** (was ~30k with static badges) — the ~18,436
  static badge files are gone. asset-sizes check: "file count under 80k threshold".
- `npm run check:patterns` clean (new `generate-badge-data.js` allowlist entry).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] History charts rendered the placeholder for every skill**
- **Found during:** Task 3 (byte-diff harness, before any human verify).
- **Issue:** `handleBadge` mapped the bundle's `[tsMs, count]` to `{ t: tsMs, c }`
  where `tsMs` is a millisecond NUMBER. The verbatim builder does
  `Date.parse(e.t)`, and `Date.parse(<number>)` returns `NaN`, so every point
  was filtered out and all 9,218 history badges fell back to the "Not enough
  history yet" placeholder — a silent regression vs. the static files.
- **Fix:** convert ms → ISO string in `handleBadge`
  (`{ t: new Date(t).toISOString(), c }`) — exactly the shape the old static
  generator fed the builder. The verbatim builder was left untouched.
- **Files modified:** worker/badge.js
- **Commit:** `0d5670c`
- **Verification:** diff harness flipped from 9,221 diffs → 0 diffs.

### [Rule 3 - Blocking] Tracked vs gitignored bundle
- The plan frontmatter described `data/badge-star-history.json` as "gitignored
  on disk", but Task 3 also requires adding it to the daily-scrape `git add`
  commit-back list. Those are contradictory (git add can't stage an ignored
  file). Resolved in favor of **tracked** — the bundle must be committed so it
  ships with the Worker on push-event deploys (same as the tracked, bundled
  `slug-redirects.json`). It is committed in Task 1 and refreshed daily by the
  workflow. No code impact; the file is a 408 KB bounded sidecar.

### Note: bundle size
- The migration doc estimated ~177.6 KB; the actual bundle is ~408 KB because
  17 daily history snapshots are now merged in on top of the backfill (more
  points per repo). Still a bounded sidecar, well under the V8 ceiling, and
  allowlisted.

## Authentication gates

None.

## Known Stubs

None. The unknown-slug / KV-miss path intentionally returns a synthetic 'listed'
badge (per plan: never 404 a hotlink) — this is required behavior, not a stub.

---

## HUMAN CHECKPOINT — required to close Task 3 (gate="blocking")

All automatable parts are done and committed. The byte-diff harness already
proved zero diff, and the build confirms `dist/badge/` is gone. The remaining
verification needs a running `wrangler dev` (the sandbox can't reliably curl a
local wrangler dev), so it is left to the human.

**Note:** the worktree has a local (gitignored) `data/skills.ndjson` copied from
the main checkout for build/verify. `wrangler dev` runs from the repo root and
bundles `data/badge-star-history.json` (committed) — no extra setup needed.

### Steps for the human

1. Start the Worker + local assets:
   ```
   npx wrangler dev
   ```
2. Tier badge (2-segment, has history):
   ```
   curl -s http://localhost:8787/badge/santifer/career-ops.svg
   ```
   Expect an SVG starting `<svg xmlns=...>` with a tier label
   (Featured/Solid/Listed).
3. History chart (same slug, has real star history):
   ```
   curl -s http://localhost:8787/badge/santifer/career-ops-history.svg
   ```
   Expect the star-history line-chart SVG (NOT the "Not enough history yet"
   placeholder).
4. Multi-segment slug:
   ```
   curl -s "http://localhost:8787/badge/K-Dense-AI/scientific-agent-skills/research-lookup.svg"
   ```
   Expect a valid tier SVG, NOT a 404.
5. Unknown slug (hotlink robustness):
   ```
   curl -s http://localhost:8787/badge/does-not/exist.svg
   ```
   Expect a 'listed'-tier badge, NOT a 404.
6. Headers:
   ```
   curl -sI http://localhost:8787/badge/santifer/career-ops.svg
   ```
   Expect `content-type: image/svg+xml; charset=utf-8` and
   `cache-control: public, max-age=86400, s-maxage=86400`.

### After the human confirms

Type **"approved"** if all curls return correct SVGs with correct headers (the
byte-diff was already proven zero). Then proceed to the deploy steps from the
migration doc step 8: branch-push (build-only) to confirm the Worker compiles,
then `main` deploy → the halved file count should clear the
`assets-upload-session` 504. Live smoke:
`curl -sI https://claudeatlas.com/badge/santifer/career-ops.svg`
→ 200 + svg content-type + cache-control; 2nd request `cf-cache-status: HIT`.

## Self-Check: PASSED

- FOUND: scripts/generate-badge-data.js
- FOUND: worker/badge.js
- FOUND: data/badge-star-history.json
- CONFIRMED DELETED: scripts/generate-badges.js
- Commits FOUND: 060ba32, 15d21d0, 0d5670c
