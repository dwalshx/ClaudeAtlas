# Future Work (Phase 2+)

This doc tracks everything *not* in Phase 1 or Phase 1.5 that we've identified as worth doing eventually. Items are grouped by theme and marked with rough size (S/M/L/XL) and strategic weight.

**Legend:**
- 🎯 **Strategic priority** — items that directly improve moat or positioning
- 🎁 **Community/growth** — items that drive creators, users, or distribution
- 🛠️ **Infrastructure** — items that unlock other features
- 📝 **Content/editorial** — items that require human judgment and writing

**Sizes:**
- S = hours
- M = 1-2 days
- L = 3-5 days
- XL = multi-week

---

## Phase 2 — Semantic & expansion

### Semantic search and similar skills 🎯 M

The highest-leverage single feature. Everything we need already exists in the index (name, description, body_markdown). Approach:

1. **Offline embedding** of all skills using OpenAI `text-embedding-3-small` (~$0.04 total cost for all 1,078 skills). Cheap and fast.
2. **Pre-compute top-5 similar skills per skill** at build time. Bake into `skills.json`. Pure enrichment of the static site — no backend needed. Adds "Similar Skills" section to every detail page.
3. **Semantic search endpoint** via Cloudflare Vectorize (native to Cloudflare, free tier generous). User query → embed → vector search → ranked results. Requires a Cloudflare Worker for query-time embedding. Crosses the static-site line but stays in the Cloudflare ecosystem.
4. **Clustering** on the embeddings for emergent categories, duplicate detection, and gap analysis.

Replaces the current keyword search entirely. Unlocks the public query API (below).

### Public query API 🎯🛠️ M

`POST https://claudeatlas.com/api/v1/search` — agents can call this to discover skills with natural-language queries. Returns ranked skills with install commands, quality signals, and detail URLs.

**Requires:** Semantic search (above)
**Strategic value:** Turns ClaudeAtlas from "a website" into "infrastructure that other agents call." Sticky in a way a pretty UI can never be.

### Expansion to plugins 🎯 M

Index Claude plugins via `path:.claude-plugin filename:marketplace.json` GitHub search. Parse the `marketplace.json` structure, index at the plugin level (not the individual SKILL.md files inside).

**New entity type:** `plugin`. Requires data-model changes (`entity_type` field, type-specific schema extensions).

**Why it matters:** Directly closes the Skills-vs-Plugins taxonomy gap that the Phase 1 Challenger flagged. Aligns ClaudeAtlas with how Claude Code users actually install extensions (`/plugin install`).

### Expansion to frameworks/systems 📝🎯 L

Repos like `gsd-build/get-shit-done` that are opinionated methodologies with many commands, agents, and skills working together. Harder to discover automatically — requires:
- Topic-based heuristics (`topic:claude-code-framework`)
- Structural signals (multiple `.claude/commands/`, `.claude/agents/`, `.claude/skills/` in one repo + substantial README)
- Mostly **manual curation with editorial write-ups** — these are review-worthy products, not scraped commodities

Probably 20-50 real frameworks total; not thousands. Closer to "reviewed products" than "indexed commodities."

### API mining and capability graph 🎯 L

Extract API/service references from SKILL.md bodies and dependency files. Build a bipartite graph: `skills ↔ APIs`.

**Outputs:**
- `/apis/[service]` pages — "Claude skills that integrate with Stripe"
- Trending APIs over time
- Gap analysis: "Which APIs have no skills yet?"
- Citable data: "47% of Claude skills integrate with OpenAI"
- Skills' detail pages show which APIs they use

**Strategic value:** Genuinely novel dataset no competitor has. Devrel teams at API providers will link back.

### marketplace.json federation 🎯🛠️ M

Register ClaudeAtlas as a Claude-compatible plugin marketplace. Users type `/plugin marketplace add claudeatlas.com` inside Claude Code and can browse/install skills directly from the CLI.

**Requires:** Understanding Anthropic's `marketplace.json` spec (which was still evolving at Phase 1 ship time).
**Strategic value:** Makes ClaudeAtlas discoverable from *inside* the tool users are already in. Closes the feedback loop.

### Expansion to commands, subagents, MCP servers 🛠️ M

- **Commands:** `.claude/commands/*.md` — individual slash command files
- **Subagents:** `.claude/agents/*.md` — subagent definitions
- **MCP servers:** `/search/code?q=mcp-server` + dependency analysis

Lower priority than plugins because:
- Commands and subagents usually ship *inside* frameworks or plugins
- MCP servers already have good directories (Smithery, glama.ai, official MCP Registry). ClaudeAtlas shouldn't duplicate.

---

## Phase 2.5 — Creator relationships

### Creator claim verification 🎁 M

Creators prove ownership of their profile via a GitHub profile README signature (SPDX-style). Claimed profiles get:
- Verified checkmark
- Custom bio (override the auto-fetched one)
- Custom social links
- Ability to hide specific skills
- Analytics on who's viewing their profile

Deferred from Phase 1.5 because the claim workflow is close to a mini-feature on its own.

### Auto-notifications to creators 🎁 M

When a skill crosses into Featured, or shows a trending star spike, automatically open a GitHub issue on the repo:
- Link to the listing page
- Star history chart (from backfilled data)
- Suggestion to embed the tier badge in their README
- Methodology link
- Explicit opt-out mechanism

**Risks to manage:**
- GitHub spam detection (aggressive rate limiting, dedicated bot account)
- Creator reception (tone must be useful, not promotional)
- False positives on "trending" detection

**Strategic value:** Converts a one-way scrape relationship into a two-way creator relationship.

### Follow-a-creator 🎁 M

Users can subscribe to a creator (no account required — RSS feed per creator at `/creators/[username]/feed.xml`). New skills from followed creators surface in the user's feed reader.

### Creator-of-the-week 📝 S (weekly) + editorial overhead

Rotating homepage feature spotlighting one creator per week. Requires:
- Manual curation
- A brief writeup
- Small design change to the homepage

### Creator leaderboard improvements 🎁 S

Current leaderboard (Phase 1.5) is static. Add:
- Time-bound leaderboards ("top creators this month")
- "Most improved" based on recent activity
- Category-specific leaderboards

---

## Phase 3 — Editorial and content

### Skill of the Week 📝 S (weekly) + editorial overhead

Hand-written weekly feature with real analysis: what the skill does, why it's notable, when to use it, trade-offs. Published at `/weekly/[YYYY-MM-DD]` and featured on the homepage.

**Strategic value:** Human judgment creates defensibility that automation can't replicate.

### "Best Claude Skills for [use case]" articles 📝 M

Curated lists for specific job-to-be-done queries. Examples:
- "Best Claude Skills for Testing"
- "Best Claude Skills for Documentation"
- "Best Claude Skills for Refactoring"

Targets long-tail SEO (every tactical agent research session mentioned this as a growth lever). Writing is the bottleneck; the underlying data already exists.

### Comparison content 📝 M

"X vs Y: which Claude testing skill should you use?" — head-to-head comparisons with evidence, quality scores, and opinion. High-signal content for users making install decisions.

### Interview series 📝 L

Talk to 5-10 top skill creators. Publish conversations. Builds relationships with creators (turns them into ClaudeAtlas advocates) and creates content that can't be replicated.

### Blog / changelog 📝 S ongoing

Simple chronological blog at `/blog` documenting ecosystem changes, methodology updates, new features, interesting data finds. Low-effort but builds credibility and SEO surface.

---

## Phase 4+ — Infrastructure and product

### Submissions flow 🎁 M

Let creators submit their skills directly. Phase 1 explicitly avoided this (per the Leadership report: "don't add submissions before the curation model is proven"). By Phase 4 the model should be proven and submissions should add value, not noise.

Requirements:
- Submission form or GitHub issue template
- Automated quality gate (same scoring as auto-discovery)
- Manual review queue for submissions that don't meet the automated bar

### Analytics dashboard (internal) 🛠️ M

Read from PostHog + Cloudflare Analytics + search query log to build an internal-only dashboard showing:
- Traffic trends
- Top pages
- Top search queries
- Gap analysis (searches with no/few results)
- Trending skills
- Creator engagement metrics

### Machine-readable changelog 🛠️ S

`/changelog.json` — lists additions, removals, and tier changes since the last snapshot. Agents can subscribe via polling.

### Historical trend views on the site 🛠️ M

Once we have 3+ months of daily snapshots, build `/trends` page with:
- "Rising this week" — highest 7-day star delta
- "Newly featured" — skills that crossed into Featured tier recently
- "Ecosystem pulse" — weekly summary numbers
- "Heating up" — categories with highest growth rate

This is Phase 2 of the original product spec ("dynamic rankings and momentum") and requires the time-series data that's compounding from Phase 1.5 onward.

### Multi-language support 🌍 L

Tactical research flagged this as "proven growth hack but not Phase 1." Translating skill metadata into 10+ languages expands SEO surface area significantly. Machine translation gets most of the way there; human review for the top pages.

### Embeddable mini-widgets 🎁 M

Beyond the tier and star history badges:
- "Top 5 Claude skills in [category]" — embeddable widget for blog posts
- "This week's trending" — embeddable for newsletters
- "Verified by ClaudeAtlas" — trust badge

Each embed carries a UTM parameter and drives traffic back.

### GraphQL API 🛠️ M

For power users and integrators who want more than the REST search API. Schema matches the public skill data model.

---

## Strategic moats — ranked by defensibility

1. **Time-series data** — starts compounding the moment daily snapshots begin (done 2026-04-11). Can never be retroactively replicated.
2. **Agent-native discoverability** (via public query API + marketplace federation) — makes ClaudeAtlas infrastructure that other agents call, not a website users visit.
3. **Capability/API graph** — genuinely novel dataset no competitor has.
4. **Creator relationships** — multi-month community game that can't be scraped.
5. **Editorial content** — human judgment that automation can't replicate.
6. **Operational trust** — uptime, transparency, responsiveness. Hard to fake, takes time.

Explicitly **not moats** (commodity):
- The scraper
- The scoring formula
- The Astro/Cloudflare stack
- The category taxonomy
- The base UI design

---

## Tracking

This doc is a living document. Items get promoted to Phase 1.5 or Phase 2 as they become time-sensitive or strategic. Items get deleted when they no longer make sense.

**To promote an item:** Move it from this file to the relevant phase scope doc, flesh out the implementation details, and mark it as scoped.

**To add an item:** Add to the appropriate Phase section with size and weight estimate. Don't skip the strategic-value question — "why does this matter for ClaudeAtlas specifically?"
