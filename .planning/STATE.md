# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-10)

**Core value:** Users can find the best Claude skill for a given task in under 30 seconds, with visible signals for why it's trustworthy.
**Current focus:** Phase 3.0.1 (Daily Pipeline State-Persistence Architecture) ready for human-verify; then Phase 3.1
**Milestone:** v3.0 — Comprehensive Agent Tooling Index (in progress)

## Current Position

Phase: 3.0.1 implementation complete — awaiting human-verify checkpoint (Task 9)
Plan: 3.0.1 has 9 tasks across 4 waves; tasks 1-8 shipped autonomously overnight 2026-04-29
Status: Code on main, release asset uploaded, awaiting morning bootstrap workflow + integration run
Last activity: 2026-04-29 — Phase 3.0.1 Wave 1-3 executed; release asset created + 295 MB skills-raw.json uploaded; awaiting morning checkpoint

Progress: Phase 1.5 [██████████] 100%, v2.0 [██████████] 100%, Phase 3.0.0 [██████████] 100% (with 3.0.1 follow-up), Phase 3.0.1 [█████████░] 89% (8/9 tasks; awaiting integration verify), Phase 3.1+ [░░░░░░░░░░] 0%

## Completed Milestones

### Phase 1.5 — Built on the MVP (shipped 2026-04-10 through ~2026-04-13)

- [x] Phase 1: Content & UX Fixes (hero stat, sticky search, expand-to-all)
- [x] Phase 2: Data Moats (skill birth dates, star-history backfill, growth + maintenance charts)
- [x] Phase 3: Distribution (tier-badge SVGs, star-history SVGs for external embed)
- [x] Phase 4: Creator Pages (/creators/[username], leaderboards, computed badges)
- [x] Phase 5: Analytics (Cloudflare Web Analytics, PostHog events, D1 search query log)
- [x] Phase 6: Infrastructure Groundwork (/skills-registry.json, /llms.txt)
- [x] Phase 1.5.1: Creators browse table at /creators/all/

### Milestone v2.0 — Agent-Native Directory (shipped ~2026-04-13)

- [x] Phase 2.1: Semantic search (OpenAI embeddings + Cloudflare Vectorize, `/api/v1/search` + homepage wired)
- [x] Phase 2.2: KV query cache code (⚠️ binding still commented out in wrangler.toml — activation is morning TODO)
- [x] Phase 2.3: Similar-skills enrichment (top-5 precomputed, rendered on detail pages)
- [x] Phase 2.4: marketplace.json federation (.claude-plugin/marketplace.json with 193 plugins)
- [x] Phase 2.5: Clustering + emergent categories (⚠️ data/skill-clusters.json produced but no site consumer; script orphaned from prebuild)

## Open Items

### Phase 3.0.1 — overnight execution (2026-04-29)

- [x] Research complete (1,154 lines, 10 questions, cited)
- [x] CONTEXT.md with locked decisions A+E+G
- [x] PLAN.md (Rev 2, 2,240 lines) PASS plan-check
- [x] Wave 1: scrape-discover-repos.js + scrape.js deprecation + filter.js fallback
- [x] Wave 2: smoke harness + bootstrap-skills-raw.yml workflow
- [x] Wave 3: re-enable Track 2/Filter in daily, re-enable weekly cron, doc updates
- [x] Release `skills-raw-bootstrap` created + 295 MB asset uploaded
- [ ] **Morning checkpoint (Task 9) — see `.planning/MORNING-CHECKLIST.md`**

### Carryover from earlier sessions

- [ ] Activate KV namespace + uncomment wrangler.toml (still pending from 2026-04-18 checklist)
- [ ] Approve scrape-plugins.js uncommitted diff disposition (still pending)
- [ ] Phase 1.5.2: Slug collision fix (rolls into Phase 3.1/3.2)

### Deferred to Phase 3.0 scope

- [ ] Phase 1.5.2: Slug collision fix (6 live duplicates; rolls into Phase 3.1/3.2 filter overhaul)
- [ ] compute-clusters.js wiring decision (wire to prebuild or delete — kickoff decision)
- [ ] Star-history incremental refresh (any new Featured skill lacks star-history until re-run)

### Deferred to backlog

- Embed star-history SVG on own detail pages (currently external-embed-only)
- Cron-failure external webhook alert
- PHASE-1.5-SCOPE.md Pagefind reference cleanup
- scripts/README.md annotating backfill scripts

## Performance Metrics

**Velocity:**
- Phase 1.5: 6 phases + 1 insertion shipped across ~3 days (≈30 hrs)
- v2.0: 5 phases shipped across ~1 day (≈8 hrs)
- Audit pass (2026-04-18): codebase map + verification + housekeeping in one session

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Phase 1.5 milestone scope locked to the six sections of `docs/PHASE-1.5-SCOPE.md`. ✅ delivered
- One GSD phase per scope-doc section — do not restructure. ✅ held
- Use substring keyword search (not Pagefind) for Phase 1 UX rebuild. ✅ in production
- Cloudflare D1 is the store for the search query log (ANALYTICS-03). ✅ live
- Do not drift from the calibrated filter rules in `scripts/filter.js` without re-validating. (3.0 will re-calibrate intentionally)
- Phase 3.0 separates algorithmic tiers (Top/Solid/Indexed) from editorial "Featured" — rename across codebase per spec
- "Featured" reserved for future human-curated content; not algorithmic

### Pending Todos

See `.planning/MORNING-CHECKLIST.md` for user-in-the-loop items.
See `docs/PHASE-3.0-SPEC.md` for Phase 3.0 sub-phase map (3.1–3.9).

### Blockers/Concerns

- **Daily pipeline awaiting first 3.0.1 integration run.** Cron has not produced fresh data since 2026-04-11. Phase 3.0.1 expected to fix; first run is the verification.
- Phase 3.0 3.1 depends on embedding infrastructure — ✅ shipped in 2.1, confirmed in codebase map
- Phase 3.0 novelty thresholds (0.45 / 0.15 in spec) are placeholders — must plot actual distribution and pick percentile-based cutoffs during 3.4 planning
- Phase 3.0 will move catalog from 1,078 → 20,000+ items; similarity matrix must use Vectorize ANN, not brute-force O(n²)
- 6 live slug collisions in data/skills.json (confirmed during audit); Worker deduplicates but sends users to arbitrary twin. Roll into 3.1/3.2.
- Topic-search recall is incomplete — Track 2 misses SKILL.md files in repos without recognized topics. Mitigated by weekly Sunday code-search full sweep.

## Session Continuity

Last session: 2026-04-29 (overnight autonomous execution of Phase 3.0.1)
Stopped at: All 8 implementation tasks shipped; release asset created + uploaded; awaiting morning human-verify checkpoint (bootstrap workflow + integration run).
Resume file: .planning/MORNING-CHECKLIST.md
