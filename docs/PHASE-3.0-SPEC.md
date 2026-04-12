# Phase 3.0 — The Comprehensive Agent Tooling Index

**Status:** Approved (spec finalized 2026-04-12)
**Rough effort:** 3-5 focused sessions
**Depends on:** Phase 2.0 shipped (semantic search, embeddings, API graph all live)

---

## Mission Statement

> **ClaudeAtlas is the Wirecutter for agent tooling.** We index every skill, plugin, and tool in the Claude ecosystem, score them on transparent quality signals, and help you find the right one for your task — whether you're a human browsing or an agent searching programmatically.

Decision test for any feature: **"Does this help someone find the right-best tool faster?"** If yes, build it. If no, defer it.

---

## What Phase 3.0 delivers

Phase 3.0 transforms ClaudeAtlas from a curated skills gallery into a comprehensive agent tooling index. Four major changes:

1. **Filter overhaul** — remove editorial gatekeeping (per-repo caps, stars minimums), replace with intelligent dedup/despam. Everything real gets indexed. Quality scores determine visibility, not existence.
2. **Plugin entity type** — index Claude plugins alongside skills, with their own scoring rubric, detail pages, and browsing surface.
3. **Novelty detection** — surface quality newcomers automatically using embedding distance, regardless of stars or community traction.
4. **Tier restructuring** — separate algorithmic quality tiers from editorial curation.

---

## Strategic context

### Positioning

Phase 1-2 established ClaudeAtlas as the "curated quality-first directory." Phase 3.0 evolves this to "comprehensive index with curation layer" — closer to Wirecutter's model:

- **Wirecutter tests everything.** They don't exclude products from consideration. → ClaudeAtlas indexes everything real.
- **Wirecutter recommends few.** Their homepage shows a single pick + 2-3 runners-up. → ClaudeAtlas's "Top" tier is the recommendation. The homepage stays curated-feeling.
- **Their reasoning is transparent.** → ClaudeAtlas shows scores, methodology, and signals.
- **"Best for X" is their killer feature.** → ClaudeAtlas's semantic search + quality scoring enables "best testing skill," "best PR review plugin," etc.

### Competitive landscape

- SkillsMP indexes 700K+ skills with no quality signals — pure volume.
- Anthropic's official marketplace is growing but has no cross-catalog quality scoring.
- ClaudeAtlas's moat is the compound infrastructure: embeddings + quality scoring + daily pipeline + novelty detection + API graph. No competitor has this stack.

### Cross-platform opportunity

The SKILL.md standard is cross-platform (Claude Code, Codex CLI, Gemini CLI, Cursor, Cline, OpenCode). Plugin scraper data shows 411 repos with explicit cross-platform signals. Phase 3.0 should acknowledge this: "Works with Claude, Codex, Gemini CLI, Cursor, and more" — without abandoning the Claude-first branding.

### Risk

Moving from "1,078 curated skills" to "20,000+ indexed skills + plugins" risks diluting the "curated" brand. **Mitigation:** the homepage and default browsing views still surface only Top-tier items. The full catalog is accessible via search, filters, and deep browsing. First-time visitors should still feel "this is curated, not scraped."

---

## Entity model

### Entity types

Phase 3.0 introduces **plugins** alongside existing **skills**. Each type has its own scoring rubric, detail page layout, and browsing surface. They are NOT cross-compared on the same scale.

| Entity | What it is | Discovery method | Scoring rubric |
|---|---|---|---|
| **Skill** | A standalone SKILL.md file | GitHub code search for `filename:SKILL.md` | 7-signal composite (existing, refined) |
| **Plugin** | A `.claude-plugin/plugin.json` bundle containing skills, agents, commands, hooks | GitHub code search for `filename:plugin.json path:.claude-plugin` | New rubric (see below) |

Future entity types (NOT in Phase 3.0):
- **Framework** — opinionated multi-repo methodology (e.g., GSD). Requires editorial curation.
- **MCP Server** — different discovery path, different ecosystem. Already well-served by Smithery/glama.ai.

### Entity hierarchy

```
Creator (person/org)
  └─ Plugin (installable unit — scored and ranked)
  │    └─ Components (skills, agents, commands, hooks — shown on detail page, not individually ranked)
  └─ Standalone Skill (SKILL.md without a plugin wrapper — scored and ranked separately)

Marketplace = lightweight publisher landing page (NOT a ranked entity)
```

### Marketplace handling

A marketplace is a **container, not a product.** Users install plugins *from* marketplaces, not marketplaces themselves.

- **Unpack every marketplace** and index individual plugins inside. Each plugin gets its own detail page, score, and badges.
- **Marketplace gets a lightweight landing page** at `/marketplaces/[owner]/[name]/` — shows all plugins from that marketplace. Not scored, not ranked. Functions as a "publisher catalog page."
- **Aggregator marketplaces** (collections of other people's work) get dedup treatment — original source versions are canonical.
- **Future consideration:** marketplace-level scoring/ranking if the ecosystem develops enough that marketplace reputation becomes a signal. Not in 3.0.

---

## Filter overhaul

### What changes

| Current (Phase 1-2) | Phase 3.0 |
|---|---|
| `MIN_STARS: 10` hard gate | **Dropped.** A 0-star skill with quality content gets indexed. |
| `MAX_PER_REPO: 2` hard cap | **Dropped.** All skills/plugins from a repo get indexed at their real scores. No diminishing returns penalty. Prolific builders are rewarded, not penalized. |
| Template/slop name blacklist | **Kept.** Still filter obvious garbage (`agent-name`, `example-skill`, etc.). |
| Min body length 500 chars | **Kept but lowered** to 200 chars. Some legitimate skills are concise. |
| Language variant dedup (`-de`, `-fr`) | **Kept.** |

### What's new

#### Embedding-based dedup

For every skill/plugin entering the filter pipeline:

```
similarity = max(cosine_similarity(new_embedding, all_existing_embeddings))
if similarity > 0.92:
  check git fork relationship via GitHub API
  compare skill_first_commit_at timestamps
  canonical = the OLDER one (or the more active fork — see active-fork rules)
  duplicate gets flagged, not hard-deleted
```

The canonical listing stays. The duplicate gets:
- Excluded from rankings, leaderboards, and default browse views
- Still findable via direct URL and search (for transparency)
- A "also available as [original]" note on its detail page
- NOT counted toward the creator's profile stats

#### Active-fork detection

When a duplicate is detected and one is a GitHub fork of the other:

1. Compare freshness: last commit, commit frequency (90 days), star velocity (30 days)
2. If the fork has **meaningful divergence** (10+ unique commits not in the parent AND embedding distance has grown > 0.1 from the original), treat it as a **successor**, not a copy
3. The successor becomes canonical. The original gets a "succeeded by [fork]" note.
4. If the fork has **no meaningful divergence** (same content, just more marketing), the original stays canonical regardless of the fork's star count.

#### Novelty scoring

Every skill/plugin gets a novelty score:

```
novelty_score = 1 - max_cosine_similarity_to_any_existing_indexed_item
```

- High novelty (> 0.45) + high quality (> 80) = **"New & Noteworthy"** — genuinely novel, well-built, fills a gap
- Low novelty (< 0.15) = likely a duplicate or near-clone
- This signal is exposed in the UI and available via the API

**This is a moat.** No other directory in this space has embedding-based novelty detection. It surfaces quality newcomers on day one, with 0 stars, purely based on "is this well-made AND does it fill a gap?"

#### Despam heuristics (refined)

Skills:
- Template/placeholder name blacklist (existing)
- Body length ≥ 200 chars (lowered from 500)
- Must have at least `name` OR `description` in frontmatter
- Embedding distinctiveness ≥ 0.05 (catches exact copies)

Plugins:
- Valid `plugin.json` with `name` field
- At least 1 component (skill, agent, command, or hook) — empty manifests are garbage
- Plugin name not in template blacklist
- Not an exact duplicate of another plugin (embedding check on manifest + component content)

---

## Tier restructuring

### Algorithmic tiers (automatic, score-based)

| Tier | Meaning | Threshold | UX treatment |
|---|---|---|---|
| **Top** | High algorithmic quality | Score ≥ 90 (skills) / TBD (plugins) | Prominently displayed. Appears in "Top Skills" / "Top Plugins" homepage sections, category landing pages, and leaderboards. |
| **Solid** | Good quality | Score 70-89 (skills) / TBD (plugins) | Visible in browse views and search results. Not featured on homepage. |
| **Indexed** | Passes dedup/despam, below Solid threshold | Score < 70 (skills) / TBD (plugins) | Findable via search and creator profiles. Not in default browse views. Not invisible — just not surfaced in curated views. |

### Editorial tier (future, human-curated)

| Tier | Meaning | How you get there |
|---|---|---|
| **Featured** | ClaudeAtlas editorial team says "this is remarkable" | Human decision. Reserved for future editorial content: skill-of-the-week, curated "best for X" lists, staff picks. NOT algorithmic. Not in Phase 3.0. |

**Key difference from Phase 1-2:** "Featured" used to mean "score ≥ 90" (algorithmic). Now "Top" means that. "Featured" is reserved for when ClaudeAtlas grows an editorial voice. This separation prevents confusion between "the algorithm ranked this high" and "a human recommends this."

---

## Plugin scoring rubric

Separate from the skill rubric. Calibrate empirically against the plugin scrape data (same iterative process used for skills in Phase 1).

| Signal | Weight | What it measures |
|---|---|---|
| **Stars** | 15% | Community trust (log-scaled) |
| **Recency** | 15% | Days since last push |
| **Manifest quality** | 20% | plugin.json has name, description, version, author. Complete manifests = professional quality. |
| **Component richness** | 20% | Number AND variety of components (skills + agents + commands + hooks). A plugin with 3 skills + 1 agent + 2 commands scores higher than one with 3 skills only. Rewards breadth of tooling. |
| **Documentation** | 15% | README quality, component-level documentation (SKILL.md body length, AGENT.md descriptions) |
| **License** | 10% | Permissive open-source license present |
| **Installability** | 5% | Structural validity — does the plugin follow the `.claude-plugin/` convention correctly? Can Claude Code's `/plugin install` actually resolve it? |

Thresholds for Top/Solid/Indexed will be calibrated after running the scorer against the full plugin dataset. Expect the distribution to be different from skills.

---

## Site architecture changes

### New routes

```
/plugins/                    ← plugin browsing (Top plugins, category filter)
/plugins/[slug]/             ← plugin detail page
/marketplaces/               ← marketplace directory (lightweight)
/marketplaces/[owner]/[name]/ ← marketplace landing page (publisher catalog)
```

### Modified routes

```
/                            ← homepage: hero + search (ALL types) + "Top Skills" section + "Top Plugins" section (separate)
/creators/[username]/        ← shows skills AND plugins by this creator
/creators/                   ← leaderboards now include plugin-based boards
/creators/all/               ← browse table adds a "plugins" column
/apis/                       ← integration graph includes plugins
/apis/[service]/             ← shows skills AND plugins that reference this service
```

### Search

The homepage search (semantic, `/api/v1/search`) returns **mixed results** with a type indicator. Each result includes `type: "skill" | "plugin"`. The UI renders type chips so users can visually distinguish.

API gets a `type` filter parameter:
```
GET /api/v1/search?q=testing+frameworks&type=plugin
GET /api/v1/search?q=code+review&type=skill
GET /api/v1/search?q=deployment+tools          ← returns both
```

### Homepage layout

```
┌─ Hero: "33,000+ analyzed · X indexed · Y top-rated · Updated daily" ─┐
├─ Sticky search bar (semantic, returns mixed skill+plugin results)    ─┤
├─ Ecosystem Pulse (charts — now includes plugin growth)               ─┤
├─ "New & Noteworthy" (novelty-detected quality newcomers, any type)   ─┤
├─ Top Skills (section, 6 cards)                                       ─┤
├─ Top Plugins (section, 6 cards)                                      ─┤
├─ Browse by category (chips — filter shows skills+plugins per cat)    ─┤
└─ Footer                                                              ─┘
```

"New & Noteworthy" is the Phase 3.0 homepage addition — powered by novelty detection. Shows items with high novelty + high quality regardless of stars or age. Refreshes daily as new skills/plugins enter the index.

---

## Data model changes

### Separate data files

```
data/skills.json              ← existing (refined filter, no caps, no stars gate)
data/skills-raw.json          ← existing scraper output
data/plugins.json             ← NEW (filtered/scored plugin catalog)
data/plugins-raw.json         ← NEW (raw plugin scraper output — already being generated)
data/skill-vectors.ndjson     ← existing (add plugin vectors too)
data/similar-skills.json      ← existing (expanded to include plugin-to-plugin and plugin-to-skill similarity)
data/api-graph.json           ← existing (expanded to include plugin integrations)
data/skill-clusters.json      ← existing (expanded with plugins in the vector space)
```

### Plugin record shape

```typescript
interface PluginRecord {
  // Identity
  id: string;                   // "repo_full_name/.claude-plugin/plugin.json"
  name: string;                 // from plugin.json name field
  slug: string;                 // "author/plugin-name" for URLs
  description: string;          // from plugin.json or README

  // Repo metadata (same as SkillRecord)
  repo_full_name: string;
  repo_url: string;
  repo_stars: number;
  // ... (same repo fields as SkillRecord)

  // Plugin-specific
  manifest: {
    name: string;
    description: string;
    version: string;
    author: { name: string; email?: string };
  };
  components: {
    skills: number;
    agents: number;
    commands: number;
    hooks: number;
    mcp_servers: number;
    total: number;
  };
  component_list: Array<{
    type: 'skill' | 'agent' | 'command' | 'hook' | 'mcp-server';
    name: string;
    path: string;
    description?: string;
  }>;
  from_marketplace: string | null;   // marketplace name if unpacked from one
  install_command: string;            // "claude plugin install owner/repo" or "plugin-name@marketplace"

  // Computed
  quality_score: number;              // 0-100 (plugin rubric, NOT skill rubric)
  quality_tier: 'top' | 'solid' | 'indexed';
  novelty_score: number;              // 0-1 (embedding distance from nearest neighbor)
  category: string;
  integrations: string[];             // from API graph
  is_duplicate: boolean;
  canonical_slug: string | null;      // if duplicate, points to canonical
}
```

### Registry changes

`/skills-registry.json` stays skills-only (backward compatibility for existing consumers).

New: `/plugins-registry.json` with the same shape but plugin records.

New: `/registry.json` — unified registry with both types, a `type` field on each entry, and top-level stats for both.

---

## Pipeline changes

### Daily cron workflow (updated)

```
1. Checkout
2. npm ci
3. (scheduled only) Scrape skills → filter skills
4. (scheduled only) Scrape plugins → filter/score plugins
5. Embed new/changed skills+plugins (OpenAI)
6. Upload vectors to Vectorize
7. Compute similar (skills+plugins in same vector space)
8. Mine APIs (skills+plugins)
9. Compute clusters (skills+plugins)
10. Generate badges (skills+plugins)
11. Generate registries (skills, plugins, unified)
12. Generate marketplace (from indexed plugins)
13. Compute novelty scores
14. Build Astro site
15. Deploy to Cloudflare Workers
16. Health check
17. (scheduled only) Commit data files
```

Steps 4, 13, and the registry/badge expansion are new. Everything else is the existing pipeline with plugins added to the input.

### New scripts

```
scripts/scrape-plugins.js      ← already written and running
scripts/score-plugin.js        ← NEW: plugin scoring (7 signals, plugin rubric)
scripts/filter-plugins.js      ← NEW: plugin-specific despam + dedup
scripts/compute-novelty.js     ← NEW: novelty scoring for all entity types
```

### Modified scripts

```
scripts/filter.js              ← remove MAX_PER_REPO, lower MIN_STARS to 0, lower MIN_BODY to 200
scripts/embed-skills.js        ← also embed plugins (reads both data files, writes to one ndjson)
scripts/compute-similar.js     ← include plugins in the similarity matrix
scripts/mine-apis.js           ← scan plugin content too
scripts/compute-clusters.js    ← include plugins in the vector space
scripts/generate-badges.js     ← generate badges for plugins too
scripts/generate-registry.js   ← generate plugins-registry.json + unified registry.json
scripts/generate-marketplace.js ← source from indexed plugins instead of Featured skills
```

---

## Phase breakdown

| Phase | What | Effort | Autonomous? |
|---|---|---|---|
| **3.1** | Filter overhaul — drop caps/stars gate, add embedding dedup, add novelty scoring. Re-run against skills-raw.json, validate distributions. | 3-4 hr | Yes (re-calibration needs Dan to eyeball the before/after distributions) |
| **3.2** | Plugin scoring + filtering — score-plugin.js, filter-plugins.js, calibrate against plugins-raw.json | 3-4 hr | Mostly (calibration review with Dan) |
| **3.3** | Plugin pages — `/plugins/`, `/plugins/[slug]/`, marketplace landing pages | 3-4 hr | Yes |
| **3.4** | "New & Noteworthy" — novelty detection, homepage section | 2 hr | Yes |
| **3.5** | Homepage + nav redesign — separate Top Skills / Top Plugins sections, mixed search results with type chips | 2-3 hr | Yes |
| **3.6** | Tier rename — Featured→Top throughout codebase + UX, "Featured" reserved for editorial | 1-2 hr | Yes |
| **3.7** | Pipeline integration — daily cron handles both scrapes, embeds both types, generates both registries | 2-3 hr | Yes |
| **3.8** | Cross-entity enrichment — creator profiles show plugins, API graph includes plugins, search returns mixed results | 2-3 hr | Yes |
| **3.9** | `/trends` page — daily snapshot data has been compounding, surface rising/trending/new arrivals | 2-3 hr | Yes |

**Total estimated effort:** 20-30 hours across 3-5 focused sessions.

**Recommended session structure:**
- Session A: 3.1 + 3.2 (filter + plugin scoring — the data-heavy calibration work)
- Session B: 3.3 + 3.4 + 3.5 (pages + UX — the visible changes)
- Session C: 3.6 + 3.7 + 3.8 (plumbing — tier rename, pipeline, cross-entity)
- Session D: 3.9 (trends — rewards the compounding data, nice capstone)

---

## What "done" looks like for Phase 3.0

- [ ] Every real skill gets indexed regardless of star count (0-star skills are findable)
- [ ] No per-repo cap — prolific builders have all their work listed
- [ ] Embedding-based dedup catches copies; original creators are canonical
- [ ] Active-fork detection routes users to the maintained version
- [ ] Novelty scoring identifies quality newcomers on day one
- [ ] "New & Noteworthy" section on the homepage, refreshed daily
- [ ] Plugins have their own scored index at `/plugins/`
- [ ] Plugin detail pages show full component inventory (skills, agents, commands, hooks)
- [ ] Marketplace landing pages at `/marketplaces/[owner]/[name]/`
- [ ] Algorithmic tiers are Top / Solid / Indexed (not "Featured")
- [ ] "Featured" is reserved for future editorial picks (no algorithmic assignment)
- [ ] Semantic search returns mixed skill+plugin results with type indicators
- [ ] `/api/v1/search` supports `type=skill|plugin` filter
- [ ] Creator profiles show skills AND plugins
- [ ] API graph includes plugin integrations
- [ ] `/skills-registry.json` unchanged (backward compatible)
- [ ] `/plugins-registry.json` new (plugin catalog for agents)
- [ ] `/registry.json` new (unified catalog)
- [ ] Daily cron scrapes both skills and plugins
- [ ] `/trends` page shows rising, trending, and new arrivals
- [ ] Homepage feels curated (Top tier only) even though the full catalog is 20k+ items
- [ ] Cross-platform compatibility noted where applicable

## Success criteria

- A new developer publishes a quality skill today with 0 stars → it appears on ClaudeAtlas tomorrow, with a novelty badge if it fills a gap
- A prolific builder with 12 excellent skills → all 12 are listed and scored independently
- A mega-repo that aggregates 200 copied skills → copies are flagged, originals are canonical
- A user searches "best testing plugin" → gets ranked results mixing skills and plugins, with type chips distinguishing them
- An agent calls `/api/v1/search?q=deployment+tools&type=plugin` → gets relevant plugin results with install commands
- The homepage still feels like "the Wirecutter of agent tooling" — curated, trustworthy, not overwhelming

---

## What's explicitly NOT in Phase 3.0

- **Editorial "Featured" picks** — requires Dan's editorial voice, not code. Phase 4+.
- **Framework entity type** — needs research on what counts as a "framework." Phase 4+.
- **MCP server entity type** — different discovery path, already served by Smithery/glama.ai. Phase 4+.
- **Creator claim verification** — SPDX-style GitHub README proof. Phase 4+.
- **Submissions flow** — "Don't add submissions before the curation model is proven." The expanded index IS the proof. Revisit in Phase 4.
- **Marketplace-level scoring/ranking** — deferred until the ecosystem develops enough that marketplace reputation becomes a meaningful signal.
- **Cross-platform rebranding** — acknowledge compatibility but don't rebrand away from "Claude" in Phase 3.0.

---

## Data available for calibration

The plugin scraper (running now, ~1,700 repos processed) will produce `data/plugins-raw.json` with:
- Full component inventory per repo (skills, agents, commands, hooks, MCP servers)
- Plugin manifests
- Marketplace manifests (with plugin listings unpacked)
- Repo metadata (stars, forks, freshness, license, topics)
- ~1,650+ repos with ~17,800+ total components

This data, combined with the existing `data/skills-raw.json` (33,078 skills), gives us the raw material to calibrate all scoring rubrics and filter thresholds empirically.

---

*Spec authored: 2026-04-12*
*Approved by: Dan Walsh*
*Next step: `/gsd:new-milestone` when ready to begin execution*
