---
phase: 2
status: complete
completed: 2026-04-10
commits: [856f098, 37aa81e]
---

# Phase 2: Data Moats — Summary

## What shipped

### DATA-01 — Skill birth date backfill ✅
- `scripts/backfill-skill-birth-dates.js` (new) — walks GitHub commits API per skill, resumable, rate-limit aware
- Ran as background job `b3l3mu6md`, completed in ~17 minutes, 100% API resolution
- All 1,078 indexed skills now have `skill_first_commit_at` populated
- 374 skills (34.7%) were created in the last 30 days — strong signal for Rising leaderboard

### DATA-02 — New-skills-per-week chart ✅
- `src/lib/charts.js` → `buildNewSkillsWeekChart(skills)` — pure build-time SVG
- Homepage Ecosystem Pulse section renders 52-week bar chart
- Uses `skill_first_commit_at` (from DATA-01), falls back to `repo_created_at`

### DATA-03 — Active-maintenance chart ✅
- `src/lib/charts.js` → `buildMaintenanceChart(skills)` — stacked horizontal bar + legend
- 5 buckets: this week / this month / last 3 months / last 6 months / stale (>6 months)
- Derived from existing `repo_pushed_at` — no API calls needed

### DATA-04 — Featured star-history backfill ⏳ RUNNING
- `scripts/backfill-star-history.js` started earlier in the session, still running at ~57/193 repos when Phase 2 was committed
- Background task `biulifv6k`
- Output: `data/star-history.json` (will commit in morning)
- Once landed, Phase 3 star-history SVG charts auto-populate on next build

## Homepage changes
- New `ecosystem-section` between Featured and Top Skills
- Hides on search (same toggle as Featured)
- Two chart cards with captions explaining data sources

## Files changed
- `src/lib/charts.js` (new, ~200 lines)
- `src/pages/index.astro` (+ecosystem-section, +hide-on-search hook)
- `scripts/backfill-skill-birth-dates.js` (new)
- `data/skills.json` (enriched with skill_first_commit_at)
- `.gitignore` (+partial files + backfill logs)

## Commits
- `856f098` — feat(phase-2): ecosystem pulse charts + backfill scripts
- `37aa81e` — data(phase-2): backfill skill_first_commit_at on all 1,078 skills
- (pending morning) — data(phase-2): star history backfill for top 193 Featured repos

## Known gaps
- **DATA-04 (star history backfill) still running at time of Phase 2 ship.** This is acceptable — the dependent Phase 3 star-history SVG charts degrade gracefully to "Not enough history yet" placeholders until `data/star-history.json` lands. Rebuilding after the backfill finishes auto-populates them.
- `CherryHQ/cherry-studio` exceeded GitHub's 40k star API pagination cap — truncated. Logged, acceptable.
