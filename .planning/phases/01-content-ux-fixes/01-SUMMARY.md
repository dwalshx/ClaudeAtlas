---
phase: 1
status: complete
completed: 2026-04-10
commit: d1b257f
---

# Phase 1: Content & UX Fixes — Summary

## What shipped

**Requirements delivered:** UX-01, UX-02, UX-03, UX-04 (4/4)

### UX-01 — Hero stat fix
- New `getPipelineStats()` helper in `src/lib/skills.js` reads `data/pipeline-stats.json` and returns `{ total_discovered, total_indexed, total_featured, updated_at }`.
- Homepage hero now renders: **"33,000 analyzed · 1,078 indexed · 305 Featured · Updated daily"** (numbers pulled live from JSON, not hardcoded).
- `BaseLayout.astro` footer and default meta description use the same three numbers.
- `methodology.astro` Discovery section embeds `{discovered}`, `{indexed}`, `{featured}` counts inline.
- Zero hardcoded skill counts remain in templates.

### UX-02 — Sticky search bar
- New `<div id="search-bar">` below the nav, `sticky top-[57px]`, backdrop-blurred, visible at all scroll positions.
- Old hero-embedded search input removed entirely.
- Clear-search (X) button appears when input has any value; clicking clears + refocuses.

### UX-03 — Expand to full catalog on search
- Homepage renders ALL 1,078 indexed skills into the DOM (not just top 60).
- Empty state: only the top 60 (`data-default-visible="true"`) are visible; the other 1,018 are hidden via inline `display: none`.
- When user types anything: Featured section hidden, browse-more footer hidden, extras revealed and filtered by substring match on name/description/category.
- Heading morphs from "Top Skills" → "Search Results"; count label morphs from "Showing top 60 of 1,078" → "N results of 1,078".

### UX-04 — Featured included in filter
- Plan kept Featured cards in the top-skills grid (they were always part of `allSkills`), so the search filter naturally includes them.
- Verification: search for any Featured skill by name — it appears in results.

## Build verification

- `npm run build` → **success**, 1088 pages built in 6.57s, no errors.
- `grep "analyzed" dist/index.html` → **"33,000 analyzed"** rendered correctly in static output.
- `grep "featured-section" dist/index.html` → 2 matches (wrapper + script reference).
- `grep "skill-search" dist/index.html` → 2 matches (input + script reference).

## Files changed

- `src/lib/skills.js` — added `getPipelineStats()` helper + pipeline-stats.json import
- `src/pages/index.astro` — hero stat, sticky search bar, expanded catalog, new script
- `src/layouts/BaseLayout.astro` — footer + default meta description updated
- `src/pages/methodology.astro` — Discovery section stats
- Total: +420 / -42 lines across 5 source files

## Dependencies / follow-ups

- Phase 2 (Data Moats) also modifies `index.astro` (adds charts). The soft-sequence dependency declared in ROADMAP.md holds — no merge conflict expected since Phase 2 adds new sections rather than modifying the ones Phase 1 edited.
- Phase 5 (Analytics) hooks the search input (`#skill-search`) for the `search_query` PostHog event and the D1 query log. The ID is stable, so Phase 5 can reference it without coordination.

## Known issues / deferred

- `top-[57px]` sticky offset for the search bar is hardcoded to the current nav height. If the nav changes height, this needs updating. Acceptable for Phase 1.5; no dynamic measurement.
- Browser preview verification was not performed (dev server workflow intentionally skipped — this is a build/static-render verification phase per CLAUDE.md guardrails). Visual QA is deferred to the human review pass in the morning.

## Commit

`d1b257f` — feat(phase-1): hero stat + search UX rebuild
