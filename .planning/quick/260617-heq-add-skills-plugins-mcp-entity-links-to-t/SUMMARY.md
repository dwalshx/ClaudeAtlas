---
quick_id: 260617-heq
slug: add-skills-plugins-mcp-entity-links-to-t
date: 2026-06-17
commit: c505106
---

# Quick Task: Add Skills | Plugins | MCP entity links to top nav

**Surface the now-live plugin/MCP catalogs in the global nav (previously only reachable via search or direct URL). First slice of Phase 3.5 (nav redesign).**

## Change

`src/layouts/BaseLayout.astro` only (shared shell):

- **Top nav** → `Skills | Plugins | MCP | Creators | APIs | Methodology | GitHub`
  - "Browse all" relabeled **Skills** (same `/browse/` target — it's the skills catalog, now a peer to the new entity types)
  - Added **Plugins** → `/plugins/` and **MCP** → `/mcp/` leading the entity group
- **Footer nav** → added Plugins + MCP (relabeled "Browse all" → "Skills" to match)
- Matched existing link styling exactly (`hover:text-white transition-colors hidden sm:block` top; `hover:text-gray-300 transition-colors` footer)

## Verification

- Dev-server rendered HTML confirmed both navs render the correct links/targets (Skills→/browse/, Plugins→/plugins/, MCP→/mcp/) in order. (preview_screenshot timed out on the heavy dev homepage renderer; HTML grep was the deterministic check.)
- `npm run check:patterns` → clean (no data/ reads introduced).
- Pushed AFTER confirming the `plugins-latest` release asset exists, so the push-event rebuild fetches plugin/MCP data (B1 fix active) and does NOT re-clobber — the nav change deploys with plugins intact.

## Notes

- Mobile: new links use `hidden sm:block` like the existing ones (collapse on small screens) — consistent, no mobile-nav regression.
- The fuller homepage rework (separate Top Skills / Top Plugins sections, mixed search type-chips) remains Phase 3.5.
