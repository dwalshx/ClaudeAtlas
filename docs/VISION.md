# ClaudeAtlas — Vision & North Star (LOOSE reference)

> **Status:** Living vision doc. NON-BINDING. This is the "don't lose the thread"
> capture of where we're heading and why — not a committed roadmap. The committed,
> sequenced plan lives in `.planning/ROADMAP.md`. Update freely; treat dates and
> ordering as directional, not promises.
>
> Last updated: 2026-06-03

## North Star

Become **the canonical, AI-discoverable discovery + ranking layer for AI tooling** —
"the Wirecutter / the Google for AI capabilities." The first stop, for **agents and
humans (and humans-via-agents)**, to find, trust, and stay current on skills, plugins,
MCPs, and the broader AI-tooling ecosystem.

Core value (unchanged): *find the best capability for a task in seconds, with visible,
trustworthy signals for why it ranks.* Extended for the agent era: *be the source AI
agents ingest and **cite**, and the place capability authors **want** to be listed
because being ranked well here drives real adoption.*

## The Vision in 5 Layers

1. **Complete the index.** Skills, plugins, MCPs, APIs — and crucially **beyond GitHub**:
   the many MCPs/skills/tools that live only on company sites, registries, and
   marketplaces. Comprehensiveness is both the moat and the citability driver.

2. **AI news / editorial layer.** Monitor key sources, produce editorial-grade updates
   ("what's new and what's rising in AI tooling"). **Double duty:** (a) a discovery
   feeder that surfaces brand-new / non-GitHub things to index (Hermes, GSD, new memory
   stacks, etc.), and (b) a content product — an endpoint for agents *and* a real
   human newsletter (e.g., beehiiv). This is the **authority engine**.

3. **Emergent trends / meta-signal.** Combine the indexing + vectorization + daily
   time-series snapshots + news timeline to surface what's rising, clustering, and
   emerging — eventually *predicting what comes next*. The compounding, hardest-to-clone
   asset. Start **descriptive** (rising/trending/new — already roadmapped as 3.9),
   earn **predictive** later.

4. **The flywheel.** Agents treat ClaudeAtlas as first-stop for capability updates.
   Companies/API vendors *want* to be listed because strong AEO (AI/answer-engine
   optimization) → discoverability by AI → adoption of well-ranked products. More
   participants → more data → more authority → stronger AEO.

5. **Own part of the index layer.** Build a useful tool, an audience, and reputation —
   and potentially influence Human + Agent web standards for capability discovery
   (llms.txt-style conventions, capability manifests, the agent-ping idea as a tiny
   proto-standard). This is an *emergent outcome* of winning the category, not a
   separate workstream.

## Strategic Annotations (the honest read)

- **Keystone risk — the whole flywheel hinges on one unproven link: ingestion → citation/referral.**
  As of 2026-06-03 we have heavy *ingestion* (OpenAI SearchBot + ClaudeBot crawled the
  catalog, June 2 surge: ~82k crawler reqs/24h) but **zero proven citations or referred
  humans yet**. Layers 4–5 are downstream of that link closing. Watch the tripwires:
  (1) referrals from chatgpt.com / perplexity / claude.ai, (2) `agent_pings`,
  (3) `search_events`. Build low-regret breadth (Layer 1) while waiting; **don't pour
  years into 3–5 before the keystone shows green.**

- **Highest-leverage *new* capability = the news/editorial layer (Layer 2).** It serves
  discovery, citability, audience, AND trend-fuel simultaneously. Consider standing it
  up **earlier than a strict breadth-first ordering implies** — authority is what drives
  citations, and editorial synthesis is how authority is manufactured. A directory is a
  commodity; "the place that tells you what's new and rising, with receipts" is not.

- **Moat = time + comprehensiveness.** Trends/prediction are defensible *because* they
  require data nobody else accumulates: the daily history snapshots, embeddings, and
  (future) news timeline. Competitors clone a directory in a weekend; they can't clone
  18 months of time-series. **This is why scraper reliability (the daily snapshot) is
  quietly load-bearing** — it protects the substrate the entire trends layer is built on.

- **Differentiation > volume for citations.** LLMs cite the *canonical/best* answer, not
  "a page that exists." Highest-leverage breadth = uniquely-ClaudeAtlas content: plugins
  (a category nobody indexes well), `/apis` (the proven SEO+impression wedge), and
  curated/ranked/compared *aggregate* views ("Top N MCPs for X"). Guard against
  breadth-for-its-own-sake crowding out authority work.

### Traps to avoid (per layer)

- **Layer 1 (non-GitHub sources):** a step-change in difficulty, not "more of the same"
  (no API, no uniform structure, anti-bot, ToS/legal, harder dedup/quality). Prioritize
  **structured registries first** (official MCP registry, marketplaces, awesome-lists);
  use LLM-extraction for the unstructured company-site tail. The polymorphic entity
  envelope (Phase 3.1.2) is the right foundation, but budget for bespoke adapters.
- **Layer 2 (editorial):** lives or dies on quality bar. AI-generated news *slop* would
  **destroy** the authority we're building. Needs human editorial judgment
  (AI-assisted, human-gated). It's a content operation — ongoing cost, different muscle.
- **Layer 3 (trends):** don't over-promise *prediction*; ship *descriptive* first.
- **Layer 4 (flywheel):** the moment ranking-well drives adoption, gaming appears
  (AEO spam, fake-skill stuffing). Scoring integrity + anti-slop becomes **existential**,
  not hygiene. The asset is **trust**, not a listing gate — we index automatically; the
  value is *ranking + authority*, not exclusivity.

### The literal "first stop for agents" mechanism

Today agents *crawl our HTML*. The leap to "first stop" is when ClaudeAtlas is a **tool
they call** — a ClaudeAtlas MCP server / capability endpoint agents query directly
("what's the best-rated MCP for X?"). This is the next **agent-infra** bet — but it's
**demand-gated**: build it when the citation signal validates that agents are actually
leaning on us, not before.

## Rough sequencing (directional, not committed)

1. **Now / in flight:** scraper reliability (Track 1 fix) → healthy daily cron emitting
   plugin+MCP+history data. *(Foundational to everything, esp. Layer 3.)*
2. **Differentiated breadth:** Phase 3.3 plugin pages → flesh out `/apis` (proven wedge)
   → continue skills/MCP coverage.
3. **Authority engine (pull earlier):** AI news / editorial layer (Layer 2) — endpoint +
   human newsletter; doubles as the non-GitHub discovery feeder.
4. **Compounding signal:** descriptive trends (`/trends`, Phase 3.9) on the time-series.
5. **Demand-gated bets:** non-GitHub / company-site indexing (Layer 1 tail), and the
   ClaudeAtlas MCP/tool ("first stop" mechanism) — both gated on the citation tripwires
   turning green.

## Open questions to revisit

- Does ingestion convert to citation? (Watch tripwires; weeks, not days.)
- Which non-GitHub sources have the highest density of unique, citable tooling?
- What's the right editorial cadence/voice, and how much can be AI-assisted without
  sacrificing the authority bar?
- When (if) the citation loop closes, what's the monetization / influence model —
  audience, reputation, standards, or something more direct?

## Near-Term Roadmap Sketch (loose, non-binding)

> Captured 2026-06-06. A *candidate* ordering, not a commitment. Formal phases live
> in `.planning/ROADMAP.md` and get refined via `/gsd:plan-phase` when started.
> Order/dates are directional.

**Where we are (2026-06-06):** Scraper-health crisis resolved — Track 1 migrated to
batched GraphQL (`SCRAPE_PAT_CLASSIC`, separate rate-limit budget), and the plugin/MCP
pipeline is temporarily gated off (`PLUGINS_ENABLED=false`) so the daily cron runs the
known-good skills-only path (history + skills + build + deploy). 3.2 code is on main and
tested but not run daily yet. Milestone v3.0 (Comprehensive Agent Tooling Index) in progress.

### A. Optimization phase — "Pipeline & Build Headroom" (proposed, BEFORE 3.3)
- **Goal:** kill the O(N²) build long-pole so the daily cron has comfortable margin under
  the 330-min cap — *before* 3.3 adds load.
- **Core:** replace `compute-similar.js`'s all-pairs cosine scan (~94 min) with **HNSW**
  (e.g. hnswlib-node) OR by querying **Cloudflare Vectorize** (embeddings already live
  there) for top-K neighbors → minutes. Approximate-nearest-neighbor trade-off accepted.
- **Maybe also:** incremental builds (re-render only changed pages), more dynamic
  rendering (like the Listed tier already is). The "run compute-similar weekly" idea is
  dropped — HNSW makes it moot (fast enough to stay daily + fresh).
- **Why first:** 3.3 adds plugin pages + plugin-similarity → more build load, and we're
  already near the ceiling (skills-only was ~297 min, ~33 min headroom). HNSW serves both
  skills *and* plugins. Optimize-first creates the headroom 3.3 consumes.
- **Rough size:** small–medium, self-contained.

### B. Phase 3.3 — "Plugins, for real"
- **3.3.0 (front half) — plugin discovery rework:** make `scrape-plugins` **incremental**
  (blob-sha skip, like Track 2's 3.0.2 fix) + a **one-time bootstrap** to populate
  `plugins-raw` (à la the skills-raw bootstrap), on its own cadence. Then flip
  `PLUGINS_ENABLED='true'`. This is the data prerequisite — without it the daily cron
  times out (the reason plugins are gated today).
- **3.3.x (back half) — plugin surfaces:** `/plugins/`, `/plugins/[slug]/`, marketplace
  landing; plugin similarity (reuses HNSW from A); mixed-type search.
- **Depends on:** A (HNSW + build headroom).

### C. Phase 3.4 — "New & Noteworthy" (the cure for the static homepage)
- **Goal:** a fresh, daily-changing surface (newly added / rising this week) *next to* the
  appropriately-stable Featured — gives returning visitors and agents a reason to come back.
- **Core:** novelty detection (`novelty_score` already on records), rising/trending from
  the daily history time-series (accumulating again post-fix), homepage section
  (+ overlaps the roadmap's 3.9 `/trends`).
- **Candidate to pull EARLIER:** it directly addresses the engagement deadness we just
  observed, and its inputs (history time-series, novelty) are nearly ready. Open decision:
  right after 3.3, or jump ahead of it.

### X. Analytics feedback loop (cross-cutting — slot anytime, high value)
- A daily-committed `data/analytics-snapshot.json`: GSC (top queries, indexed pages) +
  Cloudflare (top paths, crawler stats) + D1 (on-site searches, agent pings). Readable by
  Claude (strategy) AND usable by the site (dynamic elevation of popular/trending).
- **Caveat:** elevate on *clean* signals (GSC clicks/impressions, on-site search queries,
  agent pings) — NOT bot-dominated RUM pageviews.
- Natural pairing with C (3.4's "rising" needs the same data); could be its own small phase
  or folded into C. Also the thing that lets Claude *see* the tripwires without hand-run SQL.

### Background (not a phase): the agent-citation experiment
- Tripwires armed and baking — agent-ping guestbook, LLM referrals (chatgpt/perplexity),
  `search_events`. Months-scale signal. Watch; do NOT build more agent infrastructure until
  something shows up.

### Deferred / demand-gated (from the 5-layer vision above)
- Non-GitHub / company-site indexing; the AI news / editorial layer (+ newsletter);
  the ClaudeAtlas-MCP "first stop" tool. All gated on the citation loop showing green.

**Candidate order at a glance:** `A (Optimization/HNSW) → B (3.3 Plugins) → C (3.4 New &
Noteworthy)`, with `X (Analytics loop)` sliding in around C, and the citation experiment
baking in the background throughout.
