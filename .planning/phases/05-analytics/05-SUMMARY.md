---
phase: 5
status: code_complete_awaiting_external
completed: 2026-04-10
commit: (pending hash lookup)
---

# Phase 5: Analytics — Summary

## What shipped (code)

### ANALYTICS-01 — Cloudflare Web Analytics ⏳ dashboard toggle pending
- Beacon script conditionally injected into `BaseLayout.astro` when `PUBLIC_CF_ANALYTICS_TOKEN` env var is set
- Zero code needed beyond the conditional inclusion — Cloudflare does the rest once the site ID is added in their dashboard
- **Morning task:** Toggle Web Analytics in CF dashboard, grab the beacon token, set env var on Cloudflare Pages

### ANALYTICS-02 — PostHog client integration ⏳ signup + key pending
- `src/lib/analytics.js` — loader module, no-op when `PUBLIC_POSTHOG_KEY` env var is missing
- EU PostHog cloud hardcoded (`https://eu.i.posthog.com`) for GDPR
- Autocapture OFF, session recording OFF, pageview OFF (manual pageview logic in BaseLayout)
- 6 events wired via delegated listeners in `BaseLayout.astro`:
  1. `copy_install_command` — from `CopyButton.astro`
  2. `click_github_link` — on any `a[href*="github.com"]`
  3. `search_query` — debounced 500ms on `#skill-search`, ALSO fires `fetch('/api/log-search', ...)`
  4. `category_click` — on elements with `data-category-chip` (added to `CategoryChip.astro`)
  5. `view_skill_detail` — automatic pageview on `/skills/*`
  6. `badge_click` — detects `?ref=badge` URL param on page load
- **Morning task:** Sign up for PostHog EU, create project, grab key, set env var

### ANALYTICS-03 — D1 search query log ⏳ provisioning pending
- `worker/log-search.js` — `POST /api/log-search` handler, SHA-256 IP hash with daily rotating salt
- `worker/schema.sql` — `CREATE TABLE search_events` + indexes
- `wrangler.toml` — commented `[[d1_databases]]` binding block with 4-step activation recipe
- Client fire-and-forget POST on every debounced search_query (uses `fetch` with `keepalive: true`)
- Handler gracefully returns 202 when binding is missing (pre-provisioning), so the client doesn't retry
- **Morning task:** `wrangler d1 create claudeatlas-search-log`, apply schema, uncomment binding, set SALT_SECRET, deploy

## Privacy guarantees
- No raw IPs stored anywhere
- Daily-rotating SHA-256 salt — cross-day tracking impossible
- Query text capped at 200 chars
- No cookies beyond PostHog defaults
- EU data residency

## Files changed
- `src/lib/analytics.js` (new)
- `src/layouts/BaseLayout.astro` (+snippet injection, +event delegation, +pageview logic)
- `src/components/CopyButton.astro` (+copy_install_command event)
- `src/components/CategoryChip.astro` (+data-category-chip attr)
- `worker/log-search.js` (new)
- `worker/schema.sql` (new)
- `wrangler.toml` (+commented D1 binding block + instructions)

## Morning tasks
See `PHASE-1.5-MORNING.md` sections "Morning tasks (Phase 5 external)" 1, 2, 3.

## Commits
- (pending hash) — feat(phase-5): analytics scaffolding (PostHog + D1 search log)
