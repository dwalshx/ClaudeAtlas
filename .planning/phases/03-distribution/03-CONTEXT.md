# Phase 3: Distribution - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous overnight run)

<domain>
## Phase Boundary

Generate embeddable SVG badges for every indexed skill so creators can drop them into their READMEs and drive traffic back. Two types:
1. **Tier badge** (DIST-01) — shields.io-style pill showing Featured/Solid/Listed tier with colored background and a click-through link to the skill detail page with `?ref=badge`.
2. **Star history chart** (DIST-02) — line chart of star growth derived from `data/star-history.json` + `data/history/*.json`, with graceful "Not enough history yet" fallback.

Output: `public/badge/[author]/[skill].svg` and `public/badge/[author]/[skill]-history.svg`.
</domain>

<decisions>
## Implementation Decisions

### Build integration
- New script `scripts/generate-badges.js` runs before `astro build` (invoked manually or via new npm script `prebuild`).
- We add `"prebuild": "node scripts/generate-badges.js"` to `package.json` so `npm run build` calls it automatically.
- The script reads `data/skills.json` (already filtered), iterates every skill, writes SVGs to `public/badge/`.

### Tier badge design (DIST-01)
- shields.io-style: gray left label "claudeatlas" + colored right label with the tier name ("Featured" / "Solid" / "Listed")
- Featured: amber-500 (#f59e0b) — matches homepage Featured dot
- Solid: emerald-500 (#10b981)
- Listed: gray-500 (#6b7280)
- Height: 20px (shields.io standard). Width: dynamic based on text length, estimated at 7px per char + padding.
- Wrapped in `<a xlink:href>` pointing to `https://claudeatlas.com/skills/[slug]/?ref=badge` so clicking the badge opens the detail page. (SVG anchors work inside img tags only when the SVG is referenced directly — `<img src>` embeds strip them. Accept this limitation; Markdown embeds use the image+link pattern documented in the README.)

### Star history chart (DIST-02)
- Pure SVG line chart, 480×120 px
- Reads `data/star-history.json` (once it exists — handle missing file gracefully)
- Picks the repo for each skill via `skill.repo_full_name`
- Data points: the full event stream, downsampled to ~60 points for rendering
- Graceful fallback when no data OR < 5 stars: renders an 480×120 SVG with centered text "Not enough history yet"
- Does NOT block the build if `data/star-history.json` is missing — script warns and writes fallback SVGs for all skills

### Defer logic
- The tier badges can generate now (no data dependencies beyond `skills.json`)
- The star history SVGs write fallback placeholders if `data/star-history.json` doesn't exist yet; they'll auto-populate on the next build once the backfill completes. This is the "prep path" language from the scope doc.

### File paths / slugs
- `skill.slug` is already `[author]/[skill-name]` — use it directly for the file path
- Sanitize to avoid path traversal (no `..`, no absolute paths)

### README "For agents" section — not in Phase 3
- DIST-01/02 is about the badge infrastructure. The README update is Phase 6 (INFRA-02).
</decisions>

<code_context>
## Existing Code Insights

- `src/lib/charts.js` (from Phase 2) — has escapeXml helper and color palette to reuse
- `data/skills.json` — already has `slug`, `name`, `quality_tier` per skill
- `public/` — Astro copies everything to `dist/` verbatim. Perfect for static asset output.
- `astro.config.mjs` — can add a build hook, but a prebuild npm script is simpler and more explicit
</code_context>

<specifics>
## Specific Ideas

Tier badge example for a Featured skill `anthropics/claude-api`:

```
[claudeatlas] [Featured]     ← gray label + amber fill
```

Embed pattern for creators:
```markdown
[![ClaudeAtlas](https://claudeatlas.com/badge/anthropics/claude-api.svg)](https://claudeatlas.com/skills/anthropics/claude-api/?ref=badge)
```

Star history chart layout:
- x-axis: time, earliest star → now
- y-axis: star count
- single amber line, 2px wide
- minimal axis labels (only min date, max date, max count)
- if < 5 data points or no data: placeholder

Badge output path enforcement:
- Every skill's slug is already sanitized by the filter pipeline (lowercase, hyphens, no special chars except /)
- Still add a safety check: reject any slug containing `..` or starting with `/`
</specifics>

<deferred>
## Deferred Ideas

- PNG fallbacks (some older Markdown renderers don't support SVG in images) — out of scope for v1, SVG-only
- Animated badges, dark/light variants — Phase 4+ if we ever care
- Per-repo (not per-skill) badges — skills are the atom; per-repo is a different concept
</deferred>
