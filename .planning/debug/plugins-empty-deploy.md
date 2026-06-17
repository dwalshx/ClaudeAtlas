---
status: awaiting_recovery_dispatch
trigger: "plugins-empty-deploy: claudeatlas.com/plugins/ shows 0; regressed from 6,317 live on 2026-06-16"
created: 2026-06-17T15:10:51Z
updated: 2026-06-17T15:35:00Z
---

## Current Focus

hypothesis: TWO confirmed root causes (deploy blocker + clobber recurrence) — both fixed
test: local build of /apis/[service] cap + check:patterns + npm test + YAML validation
expecting: cap renders only N cards, lint clean, tests green, YAML well-formed
next_action: commit both fixes atomically; hand off to orchestrator for controlled production push + redeploy

## Symptoms

expected: claudeatlas.com/plugins/ lists the indexed plugins (6,317 live on 2026-06-16, 6,855 built Wednesday)
actual: claudeatlas.com/plugins/ shows 0 plugins
errors: daily-scrape run 27685290961 postbuild check-asset-sizes FATAL — dist/apis/anthropic/index.html = 25.0 MiB > Cloudflare 25 MiB cap
reproduction: (1) scheduled run builds full catalog → anthropic API page overflows 25 MiB → check-asset-sizes blocks entire deploy. (2) any push to main → push-event rebuild fetches only skills, no plugins → 0 plugin pages → deploys empty, clobbering live.
started: regressed 2026-06-16 (docs commit triggered push-event empty-plugin deploy); deploy-blocker surfaced Wednesday scheduled run 27685290961

## Eliminated

(none — root cause was confirmed before this session began; went straight to fix)

## Evidence

- timestamp: 2026-06-17T15:10:51Z
  checked: confirmed diagnosis from objective (run 27685290961 logs + workflow inspection)
  found: Bug 2 — src/pages/apis/[service].astro renders the FULL serviceSkills list; at 60,424 skills "anthropic" produced a 25.0 MiB HTML, tripping the global check-asset-sizes FATAL gate which blocks the ENTIRE deploy. Bug 1 — daily-scrape.yml publishes only skills-latest; push-event path fetches only skills; so push rebuilds produce 0 plugin pages and clobber live.
  implication: two independent fixes: (B2) cap the API service page; (B1) publish + fetch plugins/mcp release assets in the workflow.

- timestamp: 2026-06-17T15:10:51Z
  checked: src/pages/category/[category].astro (existing cap pattern), src/pages/index.astro (HOMEPAGE_LIMIT=60)
  found: category page already caps at VISIBLE_LIMIT=100 sorted by quality_score desc, with a hasMore "see all" link. Same Cloudflare 25 MiB cause documented in its inline comment (AI-and-Automation ~18k → 35 MB).
  implication: mirror that exact pattern on [service].astro for consistency.

## Resolution

root_cause: |
  Bug 2 (deploy blocker): src/pages/apis/[service].astro rendered the full list
  of skills integrating a service. At the 60k-record catalog the "anthropic"
  page reached 25.0 MiB, exceeding Cloudflare Workers Static Assets' 25 MiB
  per-asset cap. The postbuild scripts/check-asset-sizes.js gate is global, so
  the FATAL blocks the entire deploy (skills + plugins).

  Bug 1 (clobber / recurrence): .github/workflows/daily-scrape.yml publishes
  only skills.ndjson (as the skills-latest release asset) and the push-event
  path fetches only skills.ndjson. plugins.ndjson + mcp-servers.ndjson are
  gitignored and never persisted across push-event runs, so any push to main
  rebuilds with skills but zero plugins/MCPs → empty plugin pages deployed →
  clobbers live data. A docs commit on 2026-06-16 did exactly this.

fix: |
  B2 — src/pages/apis/[service].astro: cap visible cards to top 100 by
  quality_score (VISIBLE_LIMIT=100, mirroring category/[category].astro);
  compute featuredCount/totalStars over the FULL set; add a hasMore "see all
  N skills via search" link to /api/v1/search?q=<svcName>. Renders identically
  for every service (no anthropic special-case). No page can exceed the cap
  regardless of catalog size.

  B1 — .github/workflows/daily-scrape.yml: (a) new "Publish plugins-latest
  release asset" step (mirrors "Publish skills-latest release asset", same
  main-only gate) uploads data/plugins.ndjson + data/mcp-servers.ndjson to the
  plugins-latest release. (b) new "Fetch plugins-latest release asset
  (push-event path)" step (mirrors the skills push-event fetch) downloads both
  files on push events, with graceful warning + continue when the asset is
  absent (it won't exist until the first post-fix scheduled/dispatch run).

verification: |
  - npm run check:patterns → clean (0 baselined, 0 new); no readFileSync on data/ introduced
  - npm test → 199 pass, 1 skipped, 0 fail
  - daily-scrape.yml → valid YAML (js-yaml parse OK); new steps mirror skills equivalents (same GH_TOKEN auth, gh release syntax, gates, fallback style)
  - local npm run build → VERIFIED. Freshly built dist/apis/anthropic/index.html
    dropped from 6,680 cards / (pre-fix, June 12 build) to exactly 100 cards /
    176 KB, with "See all 6680 skills via search" link present. Cap logic correct;
    renders identically per-service.
  NOTE: local catalog is smaller than the 60k prod catalog; the true 25 MiB→under-cap
  proof happens on the production redeploy (orchestrator-driven). Local 176 KB at 6,680
  integrating skills confirms the cap holds well clear of the cap at any scale.

files_changed:
  - src/pages/apis/[service].astro (commit 79a29f1)
  - .github/workflows/daily-scrape.yml (commit 74c011c)

commits:
  - 79a29f1 fix(apis): cap rendered skill list on /apis/[service] pages (Fix B2)
  - 74c011c fix(ci): persist plugins/mcp NDJSON across push-event rebuilds (Fix B1)
  status: committed to main, NOT pushed — awaiting orchestrator recovery dispatch.

pending_recovery: |
  Orchestrator drives: push committed fixes to main → dispatch daily-scrape on
  main → scheduled/dispatch run publishes plugins-latest (plugins.ndjson +
  mcp-servers.ndjson) AND deploys ~6,855 plugins (anthropic API page now under
  cap, deploy unblocked) → verify claudeatlas.com/plugins/ live shows plugins
  again. After that first publish, future push-event rebuilds fetch
  plugins-latest and no longer clobber.
