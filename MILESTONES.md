# ClaudeAtlas — Milestones

A human-readable log of what shipped and when. Newest first. For the live
working state see `.planning/STATE.md`; for the forward plan see
`.planning/ROADMAP.md`.

> **Live site:** https://claudeatlas.com · **Repo:** https://github.com/dwalshx/ClaudeAtlas

---

## 🔌 Phase 3.4 — Incremental Plugin Discovery (2026-06-15) — plugins go live

The plugin & MCP pipeline is **re-enabled** — plugin/MCP data flows to the live
site for the first time. The blocker for weeks: the plugin-discovery sweep was
rate-limit-bound (~24h for a full sweep; Phase 3.3 measured it dying at ~1,700 of
~7,300 repos in 5.5h). Phase 3.4 made discovery incremental and fit it into the
daily budget:

- **Cache-wiring fix (A):** seed `processedSet` from the cached OUTPUT corpus —
  warm runs skip the ~7,300 known repos instead of re-walking them. (The root
  cause was a `.partial`-vs-OUTPUT path mismatch that left the warm cache unused.)
- **GraphQL engagement refresh (B):** batch-refresh known repos' stars/metadata on
  GraphQL's separate 5k-pts/hr budget, mirroring the skills Track-1 pulse.
- **`pushed_at` re-walk gate (C):** only re-walk repos whose components changed,
  via a single recursive `git/trees` call; the weekly FULL re-walk moved to its
  own workflow (`weekly-plugin-rewalk.yml`) so the daily cron stays steady-state.
- **Result:** daily pipeline went from *can't-finish-in-6h* to a **~90-min
  steady-state run** (cold-cache worst case ~324 min, under the 360 cap). Verified
  on branch measurements before flipping `PLUGINS_ENABLED='true'` on main.

**Live surfaces:** `/plugins/`, `/plugins/browse/`, `/plugins/{owner}/{repo}/`,
`/mcp/`, `/mcp/{owner}/{name}/`; search filters `?type=plugin|mcp_server`.

## 🧩 Phase 3.3 — Plugin & MCP Pages (2026-06-14)

Shipped the page layer for plugins and MCP servers (the data pipeline followed in
3.4). ~3,584 plugin detail pages + 76 MCP pages, discovery landings, two-step
marketplace install commands, bidirectional bundle graph (plugin ↔ bundled
skills/agents/commands/MCPs, and a "bundled in these plugins" row on skill pages),
plus the permanent `plugins-raw-ndjson-bootstrap` release + warm cache.

## ⚡ Phase 3.2.x — Plugin/MCP Scoring + HNSW Optimization (2026-05-30 → 06-11)

- **3.2 — Plugin + MCP scoring:** added `entity_type: 'plugin'` and `'mcp_server'`
  to the catalog pipeline; mixed-type feeds; bidirectional bundle data.
- **3.2.1 — HNSW optimization (shipped 2026-06-11):** replaced O(n²) cosine scans
  with approximate-NN (recall 1.0000). Enrich 59→2.8 min, compute-similar
  162→2.3 min. Reclaimed the build headroom that made the 3.4 re-enable possible.

## 🏗️ Phase 3.1.x — Filter Overhaul & Polymorphic Catalog (2026-05-27 → 05-30)

- **3.1 — Filter overhaul:** dropped MAX_PER_REPO/MIN_STARS gates; added
  embedding-based dedup (0.92 cosine) + percentile novelty + percentile tiers.
  Catalog grew from ~1,885 toward ~35k.
- **3.1.1 — F1 streaming foundation:** removed the V8 ~536 MB single-string
  ceiling assumption; all `data/` I/O moved to streaming NDJSON.
- **3.1.2 — Polymorphic entity envelope:** the on-disk record became a
  discriminated `EntityRecord` union (`entity_type` + nested `extra`).
- **3.1.3 — Agent Hub:** dynamic `llms.txt`, feeds, registry endpoints.
- **3.1.4 — Filter v2 writer.**

## 🔧 Milestone v3.0 — Infrastructure Trilogy (2026-04-14 → 05-17)

Inserted ahead of the 3.x feature lineup because the daily pipeline needed fixing
first. Outcome: `daily-scrape.yml` runs unattended at 06:30 UTC, commits fresh
data, deploys to Cloudflare.

- **3.0.0 — Split-track scrape** (Track 1 Star Pulse + Track 2 incremental discovery)
- **3.0.1 — State persistence** (GHA cache + release-asset bootstrap; switched
  discovery from `/search/code` to `/search/repositories`)
- **3.0.2 — Discovery cost reduction** (content_sha-based skip via tree blob shas)

## 🤖 Milestone v2.0 — Agent-Native Directory (~2026-04-13)

- **2.1 — Semantic search** (OpenAI embeddings + Cloudflare Vectorize, `/api/v1/search`)
- **2.2 — KV query cache** (namespace activated 2026-05-16)
- **2.3 — Similar-skills enrichment** (top-N precomputed, on detail pages)
- **2.4 — marketplace.json federation** (`.claude-plugin/marketplace.json`)
- **2.5 — Clustering + emergent categories**

## 🚀 Phase 1 + 1.5 — MVP & Build-Out (2026-04-10 → ~04-13)

- **Phase 1 (shipped 2026-04-10):** 33,078 skills analyzed, 1,078 indexed, 305
  Featured. Live site with custom domain + SSL. 7-signal quality scoring.
- **Phase 1.5:** content/UX fixes, data moats (skill birth dates, star-history
  backfill, growth/maintenance charts), distribution (embeddable tier + star
  badges), creator pages (`/creators/`), analytics, infra groundwork
  (`/skills-registry.json`, `/llms.txt`).

---

*Maintained by hand at milestone boundaries. Last updated: 2026-06-15 (Phase 3.4).*
