# Phase 5: Analytics - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous overnight run)

<domain>
## Phase Boundary

Enable real usage observability on claudeatlas.com using free-tier services only:
1. **Cloudflare Web Analytics** (ANALYTICS-01) — dashboard toggle, zero code
2. **PostHog custom events** (ANALYTICS-02) — client script tracking 6 specific events
3. **Search query log** (ANALYTICS-03) — Cloudflare Worker endpoint writing to Cloudflare D1
</domain>

<decisions>
## Implementation Decisions

### What the overnight session can do vs. what needs morning hands

**Overnight (code only, no external account changes):**
- PostHog client loader module (`src/lib/posthog.ts` or similar), reading `PUBLIC_POSTHOG_KEY` env var — no-op when missing
- Wire the six tracked events at the right DOM hooks
- D1 query log: write the Worker endpoint, the SQL schema, the `wrangler.toml` binding stub, and the client-side POST
- Build cleanly with the key placeholder

**Morning (external service, needs Dan's credentials/dashboard):**
- ANALYTICS-01: Toggle Cloudflare Web Analytics in the dashboard for claudeatlas.com
- ANALYTICS-02: Sign up for PostHog (EU cloud, for GDPR), grab the project key, add to Cloudflare env or build-time env var `PUBLIC_POSTHOG_KEY`
- ANALYTICS-03: Run `wrangler d1 create claudeatlas-search-log` and apply the schema via `wrangler d1 execute` — also uncomment the binding in wrangler.toml

All three steps documented in `PHASE-1.5-MORNING.md`.

### PostHog integration
- Import/load via PostHog's `posthog-js` npm package OR via script tag. Script tag is simpler and keeps the bundle small — use the snippet loader.
- Event names (exactly as scoped):
  - `copy_install_command` — fires from CopyButton component
  - `click_github_link` — fires when any anchor with `data-ph-github` (or `rel="noopener"` + github.com host) is clicked
  - `search_query` — fires on debounced input (~500ms), value is the query string; also sent to D1 Worker endpoint
  - `category_click` — fires when a CategoryChip is clicked
  - `view_skill_detail` — automatic pageview, no special handling needed
  - `badge_click` — fires when the page is loaded with `?ref=badge` query param
- Client snippet only loads when `PUBLIC_POSTHOG_KEY` is set (compile-time check via `import.meta.env.PUBLIC_POSTHOG_KEY`)

### D1 search query log
- **Worker endpoint**: `worker/log-search.js` — POST `/api/log-search` receives `{query, ip_hash?}`, inserts into D1 table
- **Schema**: single table `search_events` with columns `id INTEGER PRIMARY KEY, timestamp INTEGER, query TEXT, ip_hash TEXT, country TEXT`
- **Schema SQL file**: `worker/schema.sql` — can be applied via `wrangler d1 execute`
- **IP hashing**: Worker hashes the client IP with SHA-256 + a daily-rotating salt (so per-day deduplication works but cross-day tracking is impossible)
- **Debounce**: client waits 500ms after user stops typing before posting — same signal drives PostHog `search_query` and the D1 insert
- **`wrangler.toml` binding**: add a commented-out D1 binding block with instructions — user uncomments after creating the DB in the morning
- Because the Worker endpoint doesn't exist in the Static Assets setup, we ship the handler as `worker/log-search.js` and document the deployment path (the Static Assets worker can run a Workers Scripts handler too — Dan to confirm in morning)

### PostHog host
- Use EU cloud (`https://eu.i.posthog.com`) to reduce GDPR exposure
- Hardcoded in the loader — can be overridden at build time if needed

### Privacy
- No raw IPs persisted
- No user identifiers
- No PII beyond the search query text itself
- PostHog autocapture is OFF — only the six named events
</decisions>

<code_context>
## Existing Code Insights

- `src/components/CopyButton.astro` — need to emit PostHog event on click
- `src/components/CategoryChip.astro` — need to emit event on click (or mark for delegated listener)
- `src/pages/index.astro` — search input already exists from Phase 1; need to wire debounced logger
- `src/layouts/BaseLayout.astro` — where to inject the PostHog snippet (in <head> is fine)
- `wrangler.toml` — config for Workers, add commented D1 binding
- No `worker/` or `functions/` directory yet — we create `worker/log-search.js` + `worker/schema.sql`
</code_context>

<specifics>
## Specific Ideas

PostHog snippet host: `https://eu.i.posthog.com`
Default event prefix: none
Project property convention: no custom properties beyond the event name and the raw query string for `search_query`

D1 table name: `search_events`
Daily salt source: `new Date().toISOString().slice(0,10)` + a short `SALT_SECRET` env var. If SALT_SECRET is missing, use only the date — worse but not a blocker.

Search log endpoint: `POST /api/log-search` (scoped under /api/ so it's obvious and stays out of the static-asset namespace)
</specifics>

<deferred>
## Deferred Ideas

- PostHog session recording — off by default, explicit opt-in only
- Custom funnels / dashboards — Phase 4+
- A/B testing — Phase 4+
</deferred>
