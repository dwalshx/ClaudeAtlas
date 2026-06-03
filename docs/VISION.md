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
