---
gsd_state_version: 1.0
milestone: v2.0
milestone_name: — Agent-Native Directory
status: executing
stopped_at: All 3.0.x infrastructure shipped; daily pipeline verified end-to-end on commit `ebb5a80`; Phase 3.1 plan PASS plan-check on Rev 2; planning artifacts committed at `6c55715`. Phase 3.1 ready to execute.
last_updated: "2026-05-28T18:06:57.607Z"
last_activity: 2026-05-28 -- Phase 3.1.3 execution started
progress:
  total_phases: 15
  completed_phases: 3
  total_plans: 10
  completed_plans: 10
  percent: 100
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (last updated 2026-04-10)

**Core value:** Users can find the best Claude skill for a given task in under 30 seconds, with visible signals for why it's trustworthy.
**Current focus:** Phase 3.1.3 — agent-hub
**Milestone:** v3.0 — Comprehensive Agent Tooling Index (in progress)

## Current Position

Phase: 3.1.3 (agent-hub) — EXECUTING
Plan: 1 of 1
Branch: gsd/phase-3.1.2-polymorphic-envelope, 14 commits ahead of main
Status: Executing Phase 3.1.3
Next phase: **3.2 (plugin scoring + filtering)** — registries are now ready; just add plugin scorer/recipe/filter packs
Last activity: 2026-05-28 -- Phase 3.1.3 execution started

Progress: Phase 1.5 [██████████] 100% · v2.0 [██████████] 100% · 3.0.x trilogy [██████████] 100% · 3.1.1 F1 [██████████] 100% · 3.1 filter overhaul [██████████] 100% (shipped 2026-05-27) · **3.1.2 polymorphic envelope [██████████] 100% (ready-to-merge 2026-05-28)** · 3.2 plugin scoring [░░░░░░░░░░] 0% · 3.3–3.9 [░░░░░░░░░░] 0%

## Completed Milestones

### Phase 1.5 — Built on the MVP (shipped 2026-04-10 through ~2026-04-13)

- [x] Phase 1: Content & UX Fixes (hero stat, sticky search, expand-to-all)
- [x] Phase 2: Data Moats (skill birth dates, star-history backfill, growth + maintenance charts)
- [x] Phase 3: Distribution (tier-badge SVGs, star-history SVGs for external embed)
- [x] Phase 4: Creator Pages (`/creators/[username]`, leaderboards, computed badges)
- [x] Phase 5: Analytics (Cloudflare Web Analytics, PostHog events, D1 search query log)
- [x] Phase 6: Infrastructure Groundwork (`/skills-registry.json`, `/llms.txt`)
- [x] Phase 1.5.1: Creators browse table at `/creators/all/`

### Milestone v2.0 — Agent-Native Directory (shipped ~2026-04-13)

- [x] Phase 2.1: Semantic search (OpenAI embeddings + Cloudflare Vectorize, `/api/v1/search` + homepage)
- [x] Phase 2.2: KV query cache — code shipped 4/13, **namespace activated 2026-05-16**, deployed
- [x] Phase 2.3: Similar-skills enrichment (top-5 precomputed, rendered on detail pages)
- [x] Phase 2.4: marketplace.json federation (`.claude-plugin/marketplace.json` with 193 plugins)
- [x] Phase 2.5: Clustering + emergent categories (compute-clusters.js produces `data/skill-clusters.json`; visual page deferred to a future phase)

### Milestone v3.0 — Infrastructure trilogy (shipped 2026-04-14 → 2026-05-17)

These were INSERTED ahead of the Phase 3.0 spec's 3.1–3.9 lineup because the daily pipeline was broken and needed to be fixed first.

- [x] **Phase 3.0.0: Split-track scrape architecture** (Track 1 daily Star Pulse + Track 2 daily discovery)
- [x] **Phase 3.0.1: State persistence** (GHA cache + release-asset bootstrap for skills-raw.json; switched discovery from `/search/code` to `/search/repositories`)
- [x] **Phase 3.0.2: Discovery cost reduction** (content_sha-based skip via tree blob shas; per-repo SKILL.md file cap)
- [x] **Bonus fixes:** ETag cache bootstrap (4/26), V8 string-limit streaming write (4/26), saveETagCache regression fix, OPENAI_API_KEY secret name correction, KV namespace activation, bot push permission (`contents: write`), `|| true` removal on `git push`

**Outcome:** daily-scrape.yml runs unattended at 06:30 UTC, finishes in ~15 min, commits fresh data back, deploys to Cloudflare. Verified working `2026-05-17` (commit `ebb5a80` was the first real bot commit since 2026-04-11).

## Open Items

### Ready to execute next session

- **Phase 3.1 (Filter overhaul)** — `/gsd:execute-phase 3.1`
  - 10 tasks, 5 waves, ~4-6 hours
  - Drops MAX_PER_REPO + MIN_STARS gates
  - Adds embedding-based dedup (0.92 cosine, validated empirically)
  - Adds novelty scoring (percentile-based, NOT spec's 0.45 absolute — research showed that's noise floor)
  - Fixes 13 slug collisions (audit said 6; reality is 13)
  - Catalog will grow from 1,885 → ~5-15k skills
  - Spec corrections folded into `docs/PHASE-3.0-SPEC.md`

### Carryover (still pending; not blocking)

- [ ] `scripts/scrape-plugins.js` uncommitted local diff (defensive null-safety). Memo at `.planning/MORNING-SCRAPE-PLUGINS-MEMO.md`. Recommended: commit. Pending sign-off.
- [ ] `data/plugins-raw.json` (~34 MB, gitignored) sitting on disk from 4/13 plugin discovery scrape. Will be Phase 3.2 input.
- [ ] Smoke seed annual review (`data/smoke-seed.json` — some entries deliberately don't exist, verify they still 404)

### Phase v3.0 sub-phase queue (per `docs/PHASE-3.0-SPEC.md`)

- [ ] 3.1: Filter overhaul — **planned, ready**
- [ ] 3.2: Plugin scoring + filtering — not yet planned (`data/plugins-raw.json` is the input)
- [ ] 3.3: Plugin pages — not yet planned (depends on 3.2 output shape)
- [ ] 3.4: New & Noteworthy section — not yet planned (consumes 3.1's `novelty_score`)
- [ ] 3.5: Homepage + nav redesign — not yet planned (depends on 3.3 for plugin data)
- [ ] 3.6: Tier rename Featured→Top — not yet planned (codebase-wide rename)
- [ ] 3.7: Pipeline integration — daily cron handles both skills + plugins
- [ ] 3.8: Cross-entity enrichment — creator profiles + API graph include plugins
- [ ] 3.9: /trends page — needs ~30 days of daily snapshot data (started compounding 2026-05-16)

### Deferred to backlog

- HNSW / k-d tree migration for novelty when corpus grows past ~20k (O(n²) becomes expensive)
- compute-clusters.js wiring decision (orphaned from prebuild; wire in or delete)
- Star-history incremental refresh (any new Featured skill lacks star-history.json until re-run)
- Embed star-history SVG on own detail pages (currently external-embed-only)
- Cron-failure external webhook alert
- PHASE-1.5-SCOPE.md Pagefind reference cleanup

## Performance Metrics

**Velocity (this session window 2026-04-13 → 2026-05-17):**

- 3 infrastructure phases shipped (3.0.0, 3.0.1, 3.0.2)
- ~15 distinct bug fixes / config corrections across the cascade (timeout, save-on-cancel, V8 limit, content_sha skip, mega-repo cap, OPENAI_API_KEY, KV namespace, bot permission, etc.)
- Phase 3.1 fully planned (research → plan → check → revision → re-check PASS)

**Pipeline observability:**

- Daily run: ~15 min (target was <30; achieved)
- Daily request budget: comfortable (~500-800 fresh GitHub API requests; <20% of 5000/hr limit)
- Cache hit rates: high after first warm day; etag cache + skills-raw cache both bootstrapped from release assets

## Accumulated Context

### Decisions log (cumulative; see `.planning/SESSION-MEMO-2026-04-to-05.md` for full reasoning)

- 0.92 cosine threshold validated empirically for duplicate detection
- Novelty is percentile-based (top 5%), NOT absolute 0.45 (spec corrected)
- Active-fork detection is dead code (scrape skips git forks); replaced with semantic-clone via skill_first_commit_at
- Discovery uses `/search/repositories` not `/search/code` (latter doesn't support `pushed:>`)
- `skills-raw.json` persists via GHA cache + release-asset bootstrap (gitignored on disk; ~295 MB)
- `etag-cache.json` same pattern (gitignored; ~500 MB)
- Novelty computed locally from `data/skill-vectors.ndjson` (NOT Vectorize ANN — would break $12/yr budget)
- Pipeline is multi-pass: Filter → Embed → Enrich → ... — dedup needs vectors so can't happen in single pass
- `is_duplicate` filtered site-side in `src/lib/skills.js` default-browse helpers (direct URLs unaffected)
- `PRESERVED_FIELDS` extended so one-day enrich failures don't wipe dedup state
- Plugin work explicitly deferred to Phase 3.2 + 3.3; Phase 3.1 is skills-only

### Spec corrections (rolled into 3.1 Task 8)

- `docs/PHASE-3.0-SPEC.md` will be updated to:
  - Replace "0.45 novelty" with "top 5% by novelty percentile"
  - Replace "active-fork detection (10+ unique commits AND embedding distance > 0.1)" with "semantic-clone via skill_first_commit_at"
- This prevents 3.2-3.9 planning from inheriting the wrong constants.

### Blockers / Concerns

- **Phase 3.1 enrich.js O(n²) cliff** — fine at 1,885; ~13 min at 20k. Hard-warn baked in. May need HNSW migration in 3.x.
- **Plugin scraper has uncommitted local diff** — disposition recommended (commit) but awaiting sign-off.
- **No automated alerting on cron failures** — currently relies on user noticing the site is stale. Worth adding a Discord/webhook alert in a future ops phase.

## Session Continuity

Last session: 2026-05-17 (Phase 3.1 planning + final infrastructure fixes)
Stopped at: All 3.0.x infrastructure shipped; daily pipeline verified end-to-end on commit `ebb5a80`; Phase 3.1 plan PASS plan-check on Rev 2; planning artifacts committed at `6c55715`. Phase 3.1 ready to execute.

**Resume:** read `.planning/SESSION-MEMO-2026-04-to-05.md` for full context, then `/gsd:execute-phase 3.1`.

**Verification commands** to confirm state on resume:

```
gh run list --workflow=daily-scrape.yml --limit=3 --repo dwalshx/ClaudeAtlas
git log origin/main --oneline -5
ls data/history/
```

Expect: recent runs green, fresh bot commits, growing snapshot count.
