# ClaudeAtlas

The curated discovery index for production-quality Claude ecosystem skills.

**[claudeatlas.com](https://claudeatlas.com)** · **[github.com/dwalshx/ClaudeAtlas](https://github.com/dwalshx/ClaudeAtlas)**

## What is this?

ClaudeAtlas automatically discovers, scores, and indexes SKILL.md files across GitHub, presenting them as a browsable, searchable directory. Every skill is scored on 7 transparent signals and ranked into three tiers: Featured, Solid, and Listed.

## How it works

1. **Discovery** — GitHub Code Search API with size-range partitioning finds SKILL.md files across all public repos
2. **Scoring** — 7-signal quality composite (stars, recency, frontmatter, docs, issues, license, description)
3. **Categorization** — Keyword-based assignment into 8 categories
4. **Publishing** — Astro static site deployed to Cloudflare Pages, rebuilt daily

## Stack

- **Scraper:** Node.js + GitHub API
- **Site:** Astro 5 + Tailwind CSS
- **Hosting:** Cloudflare Pages (free tier)
- **CI/CD:** GitHub Actions (daily cron)
- **Search:** Client-side filtering (zero JS frameworks)
- **Cost:** ~$12/year (domain only)

## Development

```bash
# Install dependencies
npm install

# Run the scraper (requires GitHub PAT)
export GITHUB_TOKEN=ghp_xxx
npm run scrape

# Start dev server
npm run dev

# Build for production
npm run build
```

## Methodology

Quality scoring is fully transparent. See [claudeatlas.com/methodology](https://claudeatlas.com/methodology/) for the complete formula.

## For agents and tools

ClaudeAtlas publishes a machine-readable catalog of every indexed skill so agents, CLIs, and integrations can discover them programmatically:

**`https://claudeatlas.com/skills-registry.json`**

```bash
curl -s https://claudeatlas.com/skills-registry.json | jq '.count, .skills[0]'
```

Each entry contains: `name`, `slug`, `description`, `category`, `quality_tier`, `quality_score`, `install_command`, `repo_url`, `repo_stars`, `detail_url`, and `badge_url`. The file is regenerated on every daily build and served from Cloudflare's edge.

Every indexed skill also has an embeddable tier badge and a star-history chart at:

```
https://claudeatlas.com/badge/[author]/[skill].svg
https://claudeatlas.com/badge/[author]/[skill]-history.svg
```

Markdown embed:

```markdown
[![ClaudeAtlas](https://claudeatlas.com/badge/anthropics/claude-api.svg)](https://claudeatlas.com/skills/anthropics/claude-api/?ref=badge)
```

A natural-language query API (`/api/v1/search`) is planned for a future release — watch `docs/FUTURE-WORK.md` for status.

## License

Code: MIT. Data: CC-BY-4.0.
