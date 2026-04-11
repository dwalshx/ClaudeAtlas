# Phase 1: Content & UX Fixes - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous overnight run — `workflow.skip_discuss=true`)

<domain>
## Phase Boundary

Users land on the homepage and immediately understand the scale of the curation, then can search across every indexed skill without scrolling below the fold.

Scope is exactly UX-01, UX-02, UX-03, UX-04 from REQUIREMENTS.md:
- UX-01: Homepage hero displays the real `total_discovered` number from `data/pipeline-stats.json` (e.g. "33,078 analyzed · 1,078 indexed · 305 Featured · Updated daily"), and the same stat string is used on methodology page + meta description.
- UX-02: Search input is pinned in a sticky header bar visible on scroll, with a clear-search button.
- UX-03: When the search input has any value, the Featured section is hidden and the results grid expands to include all indexed skills (not just top 60), so results are above the fold.
- UX-04: Featured skills are included in the filterable dataset so every indexed skill is reachable via search.

Out of scope for this phase:
- Pagefind integration (we stay on substring filter — documented decision in PROJECT.md)
- New search fields (semantic/embeddings — Phase 2+)
- Any data/scoring changes
</domain>

<decisions>
## Implementation Decisions

### Claude's Discretion
All implementation choices are at Claude's discretion — discuss phase was skipped per `workflow.skip_discuss=true` for the overnight autonomous run. Use ROADMAP phase goal, success criteria, and existing codebase conventions to guide decisions.

Known guardrails from PROJECT.md and CLAUDE.md:
- Stay on Astro 5 + Tailwind. Do not swap renderers.
- Substring keyword filter (not Pagefind) — documented decision.
- No changes to data pipeline (`scripts/*.js`) in this phase — it's UX only.
- Read `data/pipeline-stats.json` at build time; never hardcode numbers.
- Dark theme and existing color palette from `tailwind.config.mjs` remain locked.
- Zero-downtime rollout — all changes must build cleanly.
</decisions>

<code_context>
## Existing Code Insights

Codebase context will be gathered during plan-phase research. Relevant files to expect:
- `src/pages/index.astro` (homepage with hero + Featured + search grid)
- `src/pages/methodology.astro` (methodology page with stat references)
- `src/layouts/BaseLayout.astro` (nav, footer, meta tags)
- `src/lib/skills.js` (data loader — where to read pipeline-stats)
- `data/pipeline-stats.json` (source of `total_discovered`)
- `src/components/SkillCard.astro` (card used in grids)
</code_context>

<specifics>
## Specific Ideas

Exact hero copy target: **33,078 analyzed · 1,078 indexed · 305 Featured · Updated daily**
(Pulled from `data/pipeline-stats.json.total_discovered` / `total_indexed` / `total_featured`, not hardcoded.)

Search UX target behavior:
- Empty search → current homepage (hero + categories + Featured top 60)
- Non-empty search → Featured section hidden; grid expanded to ALL indexed skills filtered by substring match on name/description/tags

Sticky header pattern: reuse any existing header component in BaseLayout; add `sticky top-0` + backdrop blur. Clear button appears only when input has a value.
</specifics>

<deferred>
## Deferred Ideas

None — discussion was not held.
</deferred>
