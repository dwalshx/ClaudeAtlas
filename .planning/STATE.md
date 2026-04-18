# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-10)

**Core value:** Users can find the best Claude skill for a given task in under 30 seconds, with visible signals for why it's trustworthy.
**Current focus:** Pre-Phase 3.0 housekeeping; then begin Phase 3.0 (Comprehensive Agent Tooling Index)
**Milestone:** Phase 1.5 + v2.0 audited and closed YELLOW (2026-04-18); Phase 3.0 spec approved and ready to plan

## Current Position

Phase: Pre-3.0 cleanup → Phase 3.1 (Filter overhaul, planned)
Plan: Housekeeping PR in progress; 3.0 has 9 sub-phases (3.1–3.9) mapped in `docs/PHASE-3.0-SPEC.md`
Status: Awaiting cron recovery verification + morning sign-offs before `/gsd:new-milestone` on 3.0
Last activity: 2026-04-18 — codebase mapped, 1.5 + v2.0 audited YELLOW, overnight housekeeping PR

Progress: Phase 1.5 [██████████] 100% (6/6 phases + 1.5.1), v2.0 [██████████] 100% (5/5 phases with caveats), 1.5.2 [░░░░░░░░░░] 0% (deferred to 3.2–3.3)

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

### Pre-Phase-3.0 housekeeping (overnight PR — 2026-04-18)

- [x] Codebase map authored (.planning/codebase/*.md — 7 docs)
- [x] 1.5 + v2.0 integration audit (.planning/VERIFICATION-1.5-v2.0.md — YELLOW verdict)
- [x] STATE.md reconciled with roadmap
- [x] data/plugins-raw.json added to .gitignore
- [ ] **Morning sign-offs needed** — see `.planning/MORNING-CHECKLIST.md`
  - [ ] Verify cron recovery (f7d293d fix awaited — no new history snapshots yet as of 2026-04-18)
  - [ ] Activate KV namespace + uncomment wrangler.toml (edit staged locally, not pushed)
  - [ ] Approve scrape-plugins.js uncommitted diff disposition
  - [ ] Approve plugins-raw.json gitignore policy

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

- **Daily cron feeder still untrusted.** f7d293d applied 2026-04-14 but no scheduled run has produced data/history/* since. Must verify in morning before 3.0 plan-milestone.
- Phase 3.0 3.1 depends on embedding infrastructure — ✅ shipped in 2.1, confirmed in codebase map
- Phase 3.0 novelty thresholds (0.45 / 0.15 in spec) are placeholders — must plot actual distribution and pick percentile-based cutoffs during 3.4 planning
- Phase 3.0 will move catalog from 1,078 → 20,000+ items; similarity matrix must use Vectorize ANN, not brute-force O(n²)
- 6 live slug collisions in data/skills.json (confirmed during audit); Worker deduplicates but sends users to arbitrary twin. Roll into 3.1/3.2.

## Session Continuity

Last session: 2026-04-18
Stopped at: Overnight housekeeping PR committed; awaiting user sign-offs in morning on KV activation, plugin scraper diff, and plugins-raw.json policy; Phase 3.0 plan-milestone ready to invoke once cron is verified green.
Resume file: .planning/MORNING-CHECKLIST.md
