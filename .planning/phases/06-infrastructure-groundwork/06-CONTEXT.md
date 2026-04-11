# Phase 6: Infrastructure Groundwork - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning
**Mode:** Auto-generated (autonomous overnight run)

<domain>
## Phase Boundary

Publish a machine-readable catalog of ClaudeAtlas skills at `https://claudeatlas.com/skills-registry.json` so agents (and future Claude plugin clients) can discover the full index programmatically. Update the README with a "For agents" section documenting the registry.

Scope: INFRA-01, INFRA-02.
</domain>

<decisions>
## Implementation Decisions

### Build integration
- New script `scripts/generate-registry.js`, runs as part of the `prebuild` chain alongside `scripts/generate-badges.js`
- `package.json` prebuild script becomes: `node scripts/generate-badges.js && node scripts/generate-registry.js`

### Registry shape (INFRA-01)
```json
{
  "name": "ClaudeAtlas",
  "url": "https://claudeatlas.com",
  "generated_at": "ISO timestamp",
  "count": 1078,
  "total_discovered": 33000,
  "total_featured": 305,
  "methodology_url": "https://claudeatlas.com/methodology/",
  "skills": [
    {
      "name": "...",
      "slug": "...",
      "description": "...",
      "category": "...",
      "quality_tier": "featured|solid|listed",
      "quality_score": 94,
      "install_command": "claude install-skill owner/repo",
      "repo_url": "...",
      "repo_stars": 1234,
      "detail_url": "https://claudeatlas.com/skills/...",
      "badge_url": "https://claudeatlas.com/badge/owner/skill.svg"
    },
    ...
  ]
}
```

### README "For agents" section (INFRA-02)
- Append a new `## For agents and tools` section to the existing README.md
- Brief paragraph, example `curl` command, example parse snippet
- Links to methodology and the registry URL

### Why a build-time JSON blob and not a query API
- Query API = Phase 2 (deferred per FUTURE-WORK.md)
- Phase 1.5 just publishes the bulk file — 1 MB of uncompressed JSON, very cache-friendly at the edge
- Phase 2 query API will live at `/api/v1/search` and support natural-language queries with embeddings
</decisions>

<code_context>
## Existing Code Insights

- `public/` is Astro's static asset root — files dropped here get copied to `dist/` verbatim
- `data/skills.json` is the source of truth; the registry is a subset + metadata
- `README.md` has a Phase 1 intro already; we're adding a section near the end (before any footer)
</code_context>

<specifics>
## Specific Ideas

Registry file size estimate: 1,078 skills × ~400 bytes of key fields ≈ 430 KB uncompressed, ~80 KB gzipped. Fine at the edge.
</specifics>

<deferred>
## Deferred Ideas

- Query API at /api/v1/search — Phase 2
- marketplace.json federation — Phase 2
- GraphQL API — Phase 4+
</deferred>
