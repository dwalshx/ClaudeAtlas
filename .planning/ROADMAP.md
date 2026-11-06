- [x] **Phase 3.3: Plugin pages** ✅ COMPLETE 2026-06-14 — pages shipped + deployed. **Pipeline re-enable DEFERRED to Phase 3.4** (plugin discovery is rate-limit-bound: ~1700/7300 repos in 5.5h, see `3.3-plugin-pages/3.3-07-MEASUREMENT.md`). `/plugins/` + `/plugins/browse/` + `/plugins/owner/name/`, `/mcp/` + `/mcp/owner/name/`, bundle-graph display (both directions), two-step marketplace install. `PLUGINS_ENABLED` stays `false` (pages live-but-empty until 3.4). Marketplace landing pages OUT (chips instead, D-06). **Planned 2026-06-11: 7 plans, 5 waves** (`.planning/phases/3.3-plugin-pages/03.3-0[1-7]-PLAN.md`):
  - [x] 03.3-01-PLAN.md — Wave 0: loadCheckpoint NDJSON fix (D-02) + declared-marketplace-name propagation (D-08), test-first
  - [x] 03.3-02-PLAN.md — Wave 1: src/lib/plugins.js loader + bundle-graph resolution + install-command derivation
  - [x] 03.3-03-PLAN.md — Wave 2: plugin detail page + two-step install + prominent Bundles section (D-09)
  - [x] 03.3-04-PLAN.md — Wave 2: MCP detail page (field swap D-05) + skill-page reverse bundle edge (D-10)
  - [x] 03.3-05-PLAN.md — Wave 3: /plugins/ landing + /plugins/browse/ + /mcp/ index + sitemap-gate widening
  - [x] 03.3-06-PLAN.md — Wave 1: bootstrap-plugins-raw.yml workflow (autonomous half of re-enable)
  - [~] 03.3-07-PLAN.md — Wave 4: Task 1 (release + warm cache) DONE; Tasks 2-3 measured → **NO-GO** (sweep rate-limit-bound), flag flip **DEFERRED to Phase 3.4** (D-01). See `03.3-07-SUMMARY.md` + `3.3-07-MEASUREMENT.md`.

- [x] **Phase 3.4: Incremental plugin discovery** ✅ COMPLETE 2026-06-16 — plugins LIVE (6,317 indexed, 638 Featured). Made `scripts/scrape-plugins.js` discovery incremental (seed-from-OUTPUT skip + GraphQL refresh + pushed_at gate + weekly full-rewalk split), flipped `PLUGINS_ENABLED=true`; first warm scheduled cron green ~2h35m, history snapshot intact. The one remaining step from 3.3 is done. **Why blocked:** the full per-repo discovery walk over ~7,300 repos burns GitHub's 5,000 REST/hr limit — a full sweep is ~24h (measured 2026-06-13, run 27472968169). **Levers** (from `3.3-07-MEASUREMENT.md`): (1) incremental discovery — persist known plugin repos, each daily run only walks NEW/changed repos via recency-filtered `search/repositories` (mirrors skills' Track 2 skip-known-IDs); (2) GraphQL batch walk — replace N per-repo REST GETs with a batched `repository(){ object(expression:"HEAD:.claude-plugin/") }` query; (3) day-sharding fallback (process repos[i] where i%N==dow, N-day freshness lag). **Done when:** a branch-measured run fits under 360 min AND `PLUGINS_ENABLED='true'` on main with the first warm scheduled run green + `data/history/<today>.json` committed. Bootstrap release + warm cache + page code already in place — re-enable is a one-line flag flip once the sweep fits. **Planned** → `/gsd:execute-phase 3.4`.
  - **Plans:** 4 plans, 4 waves (planned 2026-06-14):
    - [x] 03.4-01-PLAN.md (wave 1) — Wave 0 R-2 test + Change A: seed processedSet from cached OUTPUT (the budget fix)
    - [x] 03.4-02-PLAN.md (wave 2) — R-3 test + Change B: GraphQL batch engagement-refresh of known repos (mirror scrape-pulse.js)
    - [x] 03.4-03-PLAN.md (wave 3) — R-4 test + Change C: pushed_at re-walk gate + single recursive-tree walk + weekly full re-walk safety net
    - [x] 03.4-04-PLAN.md (wave 4) — branch-measured (cold-cache ~324 min < 360) → flipped PLUGINS_ENABLED=true → first warm cron green, plugins live
    - [x] 03.4-05-PLAN.md (gap) — split weekly full re-walk into weekly-plugin-rewalk.yml so the daily cron is steady-state only

---

## Milestone v4.0 — Data Feeds (APIs + public datasets)

**Spec:** `docs/PHASE-4.0-SPEC.md` (2026-11-01; decisions 1 + 8 resolved 2026-11-02). **Research:** `.planning/research/2026-11-01-data-feeds-sources.md`.
**Branch:** `feat/v4.0-data-feeds` (own worktree, forked from main 2026-11-02 so v3.0's open 3.5–3.9 UI phases never contend).
**Order:** 4.1 → 4.2 → 4.3 (APIs live on the site) → 4.4 → 4.5 → 4.6 → 4.7 → 4.8. Embed everything (Vectorize verified at $0.05 per 100M stored dims; not a cost governor).

### Phase 4.1: Envelope generalization

**Goal:** `api` and `dataset` become valid `entity_type`s that round-trip through every shared pipeline helper without a GitHub repo. Nullable `repo_*` for non-GitHub origins, `origin` + `home_url` + `docs_url` on `EntityCommon`, shared `access` block with per-field provenance, `ApiExtra` / `DatasetExtra`, scorer + embedding-input + rule-pack + recipe registry slots, `DATA_FEEDS_ENABLED` flag plumbing (default off, no workflow steps yet), fixtures + tests, CLAUDE.md data-model + Vectorize-cost corrections. No harvester, no pages.
**Done when:** fixture api/dataset records pass `upcastRecord` → `scoreEntity` → `buildEmbeddingInput` → `isSlop` → `assignPercentileTiers` → `assignSlugs` → NDJSON write/read with `repo_*: null`, all existing tests still green, `check:patterns` clean.
**Status:** ✅ COMPLETE 2026-11-04 — 8 plans / 5 waves executed on `feat/v4.0-data-feeds` (35 commits), verification PASSED 14/14 (`04.1-VERIFICATION.md`). Gate: 535 tests / 527 pass / 2 pre-existing fails / 6 skipped; `check:patterns` clean; legacy-shape lint 5. **Merged to main 2026-11-05 via PR #23 (merge commit 41130b0; CI 3/3 green after PR #24 fixed the stale embed-skills tests).** Context: `.planning/phases/4.1-envelope-generalization/04.1-CONTEXT.md`.
**Plans:** 8/8 plans complete

Plans:
- [x] 04.1-01-PLAN.md — Wave 1 (test-first): apis-mini + datasets-mini fixtures, RED round-trip test, RED workflow-flags test
- [x] 04.1-02-PLAN.md — Wave 1 (test-first): RED unit tests for access.js, api/dataset scorers, api/dataset rule packs, common.rules null-safety
- [x] 04.1-03-PLAN.md — Wave 1: types.d.ts + types.js (api/dataset, Origin, AccessBlock, ApiExtra, DatasetExtra, nullable repo_*) + types.test.js
- [x] 04.1-04-PLAN.md — Wave 2: scripts/lib/access.js + url-host.js; upcaster nullable buildCommonFields, origin back-fill, api/dataset upcast paths
- [x] 04.1-05-PLAN.md — Wave 3: feed.signals + api/dataset scorers (spec weights, uncalibrated) + embedding-input builders
- [x] 04.1-06-PLAN.md — Wave 3: api/dataset rule packs, dedupLanguageVariants/isFixtureRepo null-safety, api/dataset recipes (D-05 computeId)
- [x] 04.1-07-PLAN.md — Wave 4 (depends on 04/05/06): slugParts resolver, tier tie-break ?? 0, SkillCard guards, generate-registry invokedAsScript guard + buildRegistryEntry (round-trip GREEN)
- [x] 04.1-08-PLAN.md — Wave 5: DATA_FEEDS_ENABLED flag, CLAUDE.md cost + data-model corrections, phase gate + VALIDATION sign-off

### Phase 4.2: API harvest v1

**Goal:** `harvest-apis.js` (APIs.guru list + specs via ETag, data.gouv.fr dataservices, UK api-catalogue CSV, marcelscruz public-apis mirror) → `data/apis-raw.ndjson`; `filter-apis.js` with cross-source merge by primary host; `api.scorer.js` calibrated with Dan eyeballing the tier distribution; embed + enrich + upload-vectors wired behind `DATA_FEEDS_ENABLED`. Target ≈ 6–7k APIs.

**Status:** PLANNED 2026-11-05 — 13 plans / 6 waves (W0 test-first: fixtures + red tests + types; W1 pure modules; W2 merge + harvester; W3 filter + loader/embed/enrich; W4 workflows; W5 calibration + gate). Context: `04.2-CONTEXT.md`; research: `04.2-RESEARCH.md`; fixtures captured 2026-11-05 staged in `fixtures-2026-11-05/`. Execution starts only after PR #23 merges (or a stacked branch) — see 04.2-01-PLAN objective. Flag flip is NOT in 4.2 (Plan 13 documents the gap).
**Plans:** 0/13 plans complete

Plans:
- [ ] 04.2-01-PLAN.md — Wave 1 (W0): install the 7 real-response fixtures under data/__fixtures__/feeds/ + README (M13)
- [ ] 04.2-02-PLAN.md — Wave 1 (W0, red): sources / openapi-extract / http-fetch / api-access contract tests (M01, M02, M03, M06)
- [ ] 04.2-03-PLAN.md — Wave 1 (W0, red): fixture-fetch helper + api-merge / harvest-apis / filter-apis / feeds loader tests (M04, M05, M07, M08, M11)
- [ ] 04.2-04-PLAN.md — Wave 1 (W0): ApiExtra.endpoint_summaries/spec_parsed + auth.schemes, upcaster whitelist, apis-mini extension, api Freshness neutral 50 (decisions 3/5/8)
- [ ] 04.2-05-PLAN.md — Wave 2: scripts/lib/feeds/http-fetch.js — politeFetch, 5 MB streamed cap, NDJSON ETag sidecar, retry, 4-wide pool (M03)
- [ ] 04.2-06-PLAN.md — Wave 2: openapi-extract.js + api-access.js (auth precedence/schemes, SPDX + format maps, rate-limit parser 61/38) (M02, M06)
- [ ] 04.2-07-PLAN.md — Wave 2: text.js + the four source parsers (apis.guru, data.gouv.fr, UK CSV RFC 4180, public-apis) (M01)
- [ ] 04.2-08-PLAN.md — Wave 3: api-merge.js — canonicalHost/nameStem key, precedence merge, also_listed_in, provenance-preserving fill (M05)
- [ ] 04.2-09-PLAN.md — Wave 3: harvest-apis.js — catalog + spec passes, prior reuse, floors, checkpoints, catalog-only guard (M04)
- [ ] 04.2-10-PLAN.md — Wave 4: filter-apis.js (merge → upcast → gates+drop table → score → tiers → slugs → preserved) + pipeline-stats api + allowlist (M07, M08)
- [ ] 04.2-11-PLAN.md — Wave 4: src/lib/feeds.js loader; embed resolveEmbedIO + api defaults; enrich api test; snapshot/llms counts (M09, M11)
- [ ] 04.2-12-PLAN.md — Wave 5: daily-scrape.yml api legs + data_feeds input ('false' on main); measure-data-feeds.yml; .gitignore; workflow-flags rewrite; CLAUDE.md (M10)
- [ ] 04.2-13-PLAN.md — Wave 6: real local run → 4.2-CALIBRATION.md; 4.2-MEASUREMENT.md (documented gap); phase gate + VALIDATION sign-off (M12, M14)

### Phase 4.3: API pages + search

**Goal:** `/apis/` upgraded from the 69-service dictionary page to the API index; `/apis/<provider>/<name>/` detail pages (access card with provenance chips, score breakdown, spec/docs links); old service slugs 301; additive nav entry "Data" + `?type=api` search chip; Listed-tier KV render route; llms.txt / registry / feeds; methodology section. **Ship APIs visibly here.**

### Phase 4.4: Reachability probe + feed history

**Goal:** `probe-feeds.js` (politeness from `scripts/lib/reciprocal-probe.js`: robots-first, declared UA, per-host spacing, GET-only, 512 KB cap) → `data/feed-history/YYYY-MM-DD.json`; `RateLimit-*` / `X-RateLimit-*` header sniffing → `access.rate_limit` with provenance `probed`; Reachability signal live; `/bot` page updated.

### Phase 4.5: Dataset harvest v1 + pages

**Goal:** `harvest-datasets.js` (AWS Open Data Registry, OpenML, UCI, Hugging Face top-N by downloads, data.gov Catalog API with popularity floor; Zenodo/Dryad if budget allows) → `filter-datasets.js`, `dataset.scorer.js`, `/datasets/` + detail pages. Target ≈ 20–30k datasets. Open decisions 3 and 5 (popularity floors, Kaggle via Meta Kaggle) resolved at discuss time.

### Phase 4.6: Consumer graph

**Goal:** `link-consumers.js` extracts hosts/URLs from skill bodies, MCP configs and plugin manifests and matches them to API `base_urls` / dataset `download_urls`; `consumed_by[]` on feeds + `uses_feeds[]` back-edge on skills/plugins/MCPs (added to filter `PRESERVED_FIELDS`); replaces `mine-apis.js`'s hand dictionary; Ecosystem-adoption signal live; "Data sources used" section on skill/plugin/MCP pages.

### Phase 4.7: Access-metadata extraction ladder

**Goal:** heuristic regex pass over fetched docs/pricing pages, bounded LLM pass on Featured/Solid APIs only (open decision 2: needs Dan's cost approval), `data/feed-overrides.json` manual layer, provenance chips polished.

### Phase 4.8: GitHub OpenAPI discovery

**Goal:** partitioned GitHub code-search enumeration of `openapi.*` / `swagger.*` (separate 10 req/min bucket, 1,000 results/query → partition by size/language/org), noise gates, spec fetch via existing ETag machinery, incremental like Phase 3.4, cron audit. The lever from ~7k to 25k+ APIs. Measured go/no-go like 3.3-07.