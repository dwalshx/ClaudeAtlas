# Phase 3.3 — Deferred Items (out-of-scope discoveries logged during execution)

## From Plan 04 execution (2026-06-12)

### sitemap-completeness gate FATAL once plugin + MCP pages co-exist (Plan 05 scope — measured numbers for handoff)

- **Observed:** `npm run build` postbuild gate fails with
  `FATAL: <loc> count 29032 not in [23023, 26505]` when the wave-2 page sets
  (Plan 03's 3,584 plugin pages + Plan 04's 76 MCP pages) are both in the tree.
- **Math:** 29,032 locs = 23,048 skill slugs (customPages) + 3,584 plugins +
  2,228 creators + 76 mcp + ~96 other static pages. Tolerance is
  `max(1500, 15% of skill count)` = 3,457 → ceiling 26,505. Plugin pages alone
  account for the overage; MCP pages alone (without plugins) would land at
  25,448 — inside the range.
- **Resolution owner:** Plan 05 (`scripts/check-sitemap-completeness.js` is in
  its `files_modified`; widening the expected-count basis to skills + plugins +
  MCPs is its assigned task, per RESEARCH Pitfall 4).
- **Action taken in Plan 04:** none (file is another plan's scope). The Astro
  build itself completes cleanly (15,204 pages); only the postbuild gate trips.

### Parallel executors share one working directory — concurrent `npm run build` collides

- **Observed:** simultaneous Plan 03 + Plan 04 builds in the same checkout
  crashed with `ENOTEMPTY: rmdir 'public/badge'` (generate-badges.js clearing
  the dir while the other build held files). Resolved by waiting for the
  other build to exit and retrying.
- **Note for orchestrator:** wave-parallel executors that both run
  `npm run build` need either worktree isolation or build serialization.
